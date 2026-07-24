// 手机号标记 OSINT 数据源
// 使用 tmini.net API (id=4 腾讯标记) 查询服务号码的标记/骚扰状态
// 出于隐私/伦理考虑,仅查询公共服务号码(运营商/银行/客服),不查询个人号码
// 返回: 运营商信息、标记标签、骚扰计数
// 信号: 负面标记数量高的号码(可能被冒充或存在骚扰行为)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const BASE = 'https://www.tmini.net/apidata';

// 仅查询公共服务号码 —— 运营商/银行/保险/快递/政务
// 这些号码本身是公开的官方客服,查询其标记状态用于检测"号码被冒充/诈骗者使用"的情况
const SERVICE_NUMBERS = [
  { phone: '10086', carrier: '中国移动', category: '运营商' },
  { phone: '10000', carrier: '中国电信', category: '运营商' },
  { phone: '10010', carrier: '中国联通', category: '运营商' },
  { phone: '95588', carrier: '中国工商银行', category: '银行' },
  { phone: '95533', carrier: '中国建设银行', category: '银行' },
  { phone: '95555', carrier: '中国招商银行', category: '银行' },
  { phone: '95566', carrier: '中国银行', category: '银行' },
  { phone: '95599', carrier: '中国农业银行', category: '银行' },
  { phone: '95511', carrier: '中国平安', category: '保险' },
  { phone: '95558', carrier: '中信银行', category: '银行' },
  { phone: '95110', carrier: '12345政务热线', category: '政务' },
  { phone: '12306', carrier: '铁路客服', category: '交通' },
  { phone: '11183', carrier: 'EMS邮政速递', category: '快递' },
  { phone: '95577', carrier: '华夏银行', category: '银行' },
];

async function fetchWithTimeout(url, opts = {}, timeoutMs = 13000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json,text/plain,*/*',
        'Referer': 'https://www.tmini.net/',
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { rawText: text.slice(0, 500) };
    }
  } finally {
    clearTimeout(timer);
  }
}

// tmini.net 返回字段兼容解析 (不同 id 返回结构略有差异)
function parseMarking(payload, phone) {
  if (!payload) return { phone, error: 'empty response' };

  const data = payload.data || payload;
  if (data?.error || payload.code === 0 || payload.code === 400) {
    return {
      phone,
      error: data?.error || payload.msg || payload.message || 'no data',
    };
  }

  // 常见字段名: count(标记数), label/tag(标记类型), carrier(运营商), area(归属地)
  const marking = {
    phone,
    carrier: data.carrier || data.operator || data.isp || null,
    area: data.area || data.region || data.location || null,
    markCount: Number(data.count || data.markCount || data.mark_count || 0) || 0,
    labels: [],
    markingType: data.type || data.markType || null,
    message: data.msg || data.message || null,
  };

  // 标记标签: 可能是字符串/数组/对象
  const labelRaw = data.label || data.tag || data.tags || data.name || data.mark;
  if (Array.isArray(labelRaw)) {
    marking.labels = labelRaw.map((l) => String(l?.name || l?.label || l || '').trim()).filter(Boolean);
  } else if (typeof labelRaw === 'object' && labelRaw) {
    marking.labels = Object.values(labelRaw)
      .map((l) => String(l?.name || l?.label || l || '').trim())
      .filter(Boolean);
  } else if (labelRaw) {
    marking.labels = [String(labelRaw).trim()];
  }

  // 是否被标记为骚扰/诈骗
  const negativeLabels = marking.labels.filter((l) =>
    /骚扰|诈骗|欺诈|推销|中介|快递|外卖|贷款|催收|广告|骚扰电话|诈骗电话|推销电话/i.test(l)
  );
  marking.negativeLabels = negativeLabels;
  marking.isFlagged = negativeLabels.length > 0 || marking.markCount >= 50;

  return marking;
}

async function queryPhone(meta, staggerMs) {
  if (staggerMs > 0) await new Promise((r) => setTimeout(r, staggerMs));
  try {
    const payload = await fetchWithTimeout(`${BASE}?id=4&phone=${encodeURIComponent(meta.phone)}`);
    const result = parseMarking(payload, meta.phone);
    return {
      ...meta,
      ...result,
      queriedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      ...meta,
      phone: meta.phone,
      error: e.message,
      queriedAt: new Date().toISOString(),
    };
  }
}

// 限制并发 + 错开请求,避免 tmini.net 限流 (QPS≈5)
async function mapWithConcurrency(items, limit, staggerMs, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      if (staggerMs > 0 && next < items.length) {
        await new Promise((r) => setTimeout(r, staggerMs));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function buildSignals(markingResults) {
  const signals = [];

  const ok = markingResults.filter((r) => !r.error);
  const failed = markingResults.filter((r) => r.error);
  signals.push(
    `PHONE-INTEL COVERAGE: ${ok.length}/${markingResults.length} 服务号码查询成功` +
      (failed.length ? ` (失败 ${failed.length})` : '')
  );

  // 被标记为骚扰/诈骗的服务号码 —— 这是高优先级信号(可能被冒充)
  const flagged = ok.filter((r) => r.isFlagged);
  if (flagged.length) {
    signals.push(
      `PHONE FLAGGED (${flagged.length} service numbers flagged as harassment/fraud): ` +
        flagged
          .map(
            (r) =>
              `${r.phone}(${r.carrier || r.category})[${r.negativeLabels.join('/') || `count=${r.markCount}`}]`
          )
          .join(' | ')
    );
  }

  // 高标记数的服务号码 (markCount >= 100)
  const highMark = ok.filter((r) => r.markCount >= 100).sort((a, b) => b.markCount - a.markCount);
  if (highMark.length) {
    signals.push(
      `PHONE HIGH-MARK (${highMark.length} numbers with 100+ marks): ` +
        highMark
          .slice(0, 5)
          .map((r) => `${r.phone}(${r.carrier || r.category})=${r.markCount}`)
          .join(' | ')
    );
  }

  // 运营商号码被冒充风险 (运营商客服本不应有骚扰标记)
  const carrierSpoofed = flagged.filter(
    (r) => r.category === '运营商' && r.negativeLabels.length > 0
  );
  if (carrierSpoofed.length) {
    signals.push(
      `CARRIER SPOOFING RISK: ${carrierSpoofed.length} 个运营商客服号码出现负面标记,可能被冒充 — ` +
        carrierSpoofed.map((r) => `${r.phone}(${r.carrier})`).join(' | ')
    );
  }

  // 银行号码被冒充风险
  const bankSpoofed = flagged.filter(
    (r) => r.category === '银行' && r.negativeLabels.length > 0
  );
  if (bankSpoofed.length) {
    signals.push(
      `BANK SPOOFING RISK: ${bankSpoofed.length} 个银行客服号码出现负面标记,可能被冒充 — ` +
        bankSpoofed.map((r) => `${r.phone}(${r.carrier})`).join(' | ')
    );
  }

  return signals;
}

export async function briefing() {
  const timestamp = new Date().toISOString();
  try {
    // 并发 2 + 错开 250ms,tmini.net QPS≈5
    const results = await mapWithConcurrency(SERVICE_NUMBERS, 2, 250, queryPhone);

    const signals = buildSignals(results);
    const ok = results.filter((r) => !r.error);
    const flagged = ok.filter((r) => r.isFlagged);

    return {
      source: 'Phone-Intel',
      timestamp,
      endpoint: `${BASE}?id=4`,
      category: 'service-number-marking',
      total: SERVICE_NUMBERS.length,
      ok: ok.length,
      failed: results.length - ok.length,
      flaggedCount: flagged.length,
      items: results,
      signals,
      meta: {
        disclaimer:
          '仅查询公共服务号码(运营商/银行/政务)的标记状态,用于检测号码冒充与诈骗风险',
        queryScope: 'service-numbers-only',
        apiId: 4,
        apiName: 'tencent-phone-marking',
      },
    };
  } catch (e) {
    return {
      source: 'Phone-Intel',
      timestamp,
      error: e.message,
      items: [],
      signals: [`PHONE-INTEL FETCH FAILED: ${e.message}`],
    };
  }
}

if (process.argv[1]?.endsWith('phone-intel.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
