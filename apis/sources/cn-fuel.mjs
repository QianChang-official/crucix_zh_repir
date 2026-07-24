// 全国油价数据源
// 使用 tmini.net API (apidata id=24) 获取各省 0号柴油 / 89/92/95/98号汽油价格
// 信号: 高于/低于全国均价的省份、价格显著波动

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const BASE = 'https://www.tmini.net/apidata';

// 油品代码与名称映射
const FUEL_TYPES = {
  q89: '89号汽油',
  q92: '92号汽油',
  q95: '95号汽油',
  q98: '98号汽油',
  q0: '0号柴油',
};

// 价格波动阈值 (元/升) —— 超过此值视为显著变化
const SIGNIFICANT_CHANGE_THRESHOLD = 0.15;

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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// tmini.net 返回字段兼容解析 —— 各省油价
function parseFuelPrices(payload) {
  if (!payload) return { provinces: [], updatedAt: null };

  // 常见返回结构: { code, data: { list: [...] } } 或 { data: [...] }
  const rawList =
    payload.data?.list ||
    payload.data?.items ||
    payload.data?.data ||
    (Array.isArray(payload.data) ? payload.data : payload.list) ||
    [];

  if (!Array.isArray(rawList)) return { provinces: [], updatedAt: null };

  const provinces = rawList
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const name = String(entry.province || entry.name || entry.area || entry.region || '').trim();
      if (!name) return null;

      // 兼容多种字段名: q89 / p89 / price89 / gasoline89
      const prices = {};
      for (const [key, label] of Object.entries(FUEL_TYPES)) {
        const val =
          entry[key] ??
          entry[key.replace('q', 'p')] ??
          entry[`price${key.slice(1)}`] ??
          entry[`gasoline${key.slice(1)}`] ??
          entry[label] ??
          null;
        const num = toNumber(val);
        if (num != null) prices[label] = num;
      }

      // 0号柴油可能单独字段: diesel / q0 / p0
      if (prices['0号柴油'] == null) {
        const diesel = toNumber(entry.q0 ?? entry.p0 ?? entry.diesel ?? entry.diesel0 ?? entry.price0);
        if (diesel != null) prices['0号柴油'] = diesel;
      }

      return {
        province: name,
        prices,
        // 部分接口提供涨跌字段
        changes: entry.changes || entry.change || null,
        updatedAt: entry.time || entry.updateTime || entry.updated || entry.date || null,
      };
    })
    .filter(Boolean);

  return {
    provinces,
    updatedAt: payload.data?.time || payload.data?.updateTime || payload.time || null,
  };
}

function computeNationalAverage(provinces) {
  const sums = {};
  const counts = {};
  for (const p of provinces) {
    for (const [fuel, price] of Object.entries(p.prices)) {
      if (price == null) continue;
      sums[fuel] = (sums[fuel] || 0) + price;
      counts[fuel] = (counts[fuel] || 0) + 1;
    }
  }
  const averages = {};
  for (const fuel of Object.keys(FUEL_TYPES)) {
    if (counts[fuel]) averages[fuel] = sums[fuel] / counts[fuel];
  }
  return averages;
}

function buildSignals(provinces, nationalAvg) {
  const signals = [];

  if (!provinces.length) {
    signals.push('CN-FUEL: 油价数据为空或解析失败');
    return signals;
  }

  signals.push(`CN-FUEL COVERAGE: ${provinces.length} 个省份油价数据已采集`);

  // 全国均价摘要
  const avgLine = Object.entries(nationalAvg)
    .map(([fuel, avg]) => `${fuel}=${avg.toFixed(2)}`)
    .join(' ');
  if (avgLine) {
    signals.push(`CN-FUEL NATIONAL AVG: ${avgLine}`);
  }

  // 92号汽油 —— 最常见基准
  const benchmark = '92号汽油';
  if (nationalAvg[benchmark]) {
    const avg = nationalAvg[benchmark];
    const sorted = provinces
      .filter((p) => p.prices[benchmark] != null)
      .sort((a, b) => b.prices[benchmark] - a.prices[benchmark]);

    // 最高价省份
    if (sorted.length) {
      const highest = sorted[0];
      const lowest = sorted[sorted.length - 1];
      const spread = highest.prices[benchmark] - lowest.prices[benchmark];
      signals.push(
        `CN-FUEL 92# SPREAD: 最高 ${highest.province}=${highest.prices[benchmark].toFixed(2)} / 最低 ${lowest.province}=${lowest.prices[benchmark].toFixed(2)} / 价差 ${spread.toFixed(2)}元`
      );
    }

    // 显著高于均价的省份 (+0.30 元以上)
    const aboveAvg = sorted
      .filter((p) => p.prices[benchmark] - avg >= 0.30)
      .map((p) => `${p.province}(${p.prices[benchmark].toFixed(2)})`);
    if (aboveAvg.length) {
      signals.push(
        `CN-FUEL 92# ABOVE AVG (>=+0.30): ${aboveAvg.join(' | ')} (全国均价 ${avg.toFixed(2)})`
      );
    }

    // 显著低于均价的省份 (-0.30 元以上)
    const belowAvg = sorted
      .filter((p) => avg - p.prices[benchmark] >= 0.30)
      .map((p) => `${p.province}(${p.prices[benchmark].toFixed(2)})`);
    if (belowAvg.length) {
      signals.push(
        `CN-FUEL 92# BELOW AVG (>=-0.30): ${belowAvg.join(' | ')} (全国均价 ${avg.toFixed(2)})`
      );
    }
  }

  // 0号柴油 —— 物流/运输成本基准
  const diesel = '0号柴油';
  if (nationalAvg[diesel]) {
    const dAvg = nationalAvg[diesel];
    const dSorted = provinces
      .filter((p) => p.prices[diesel] != null)
      .sort((a, b) => b.prices[diesel] - a.prices[diesel]);
    if (dSorted.length) {
      const dHigh = dSorted[0];
      const dLow = dSorted[dSorted.length - 1];
      signals.push(
        `CN-FUEL DIESEL #0: 最高 ${dHigh.province}=${dHigh.prices[diesel].toFixed(2)} / 最低 ${dLow.province}=${dLow.prices[diesel].toFixed(2)} / 均价 ${dAvg.toFixed(2)}`
      );
    }
  }

  // 98号汽油 —— 高端消费/炼化能力指标
  const premium = '98号汽油';
  if (nationalAvg[premium]) {
    const pSorted = provinces
      .filter((p) => p.prices[premium] != null)
      .sort((a, b) => b.prices[premium] - a.prices[premium]);
    if (pSorted.length) {
      signals.push(
        `CN-FUEL 98# RANGE: ${pSorted[0].province}=${pSorted[0].prices[premium].toFixed(2)} → ${pSorted[pSorted.length - 1].province}=${pSorted[pSorted.length - 1].prices[premium].toFixed(2)}`
      );
    }
  }

  // 价格波动检测 (若接口提供 changes 字段)
  const volatile = provinces.filter((p) => {
    if (!p.changes) return false;
    for (const v of Object.values(p.changes)) {
      const n = toNumber(v);
      if (n != null && Math.abs(n) >= SIGNIFICANT_CHANGE_THRESHOLD) return true;
    }
    return false;
  });
  if (volatile.length) {
    signals.push(
      `CN-FUEL VOLATILITY (>=±${SIGNIFICANT_CHANGE_THRESHOLD}元): ${volatile
        .map((p) => p.province)
        .join(' | ')}`
    );
  }

  return signals;
}

export async function briefing() {
  const timestamp = new Date().toISOString();
  try {
    const payload = await fetchWithTimeout(`${BASE}?id=24`);
    const { provinces, updatedAt } = parseFuelPrices(payload);

    if (!provinces.length) {
      return {
        source: 'CN-Fuel',
        timestamp,
        endpoint: `${BASE}?id=24`,
        error: 'no province data parsed',
        items: [],
        signals: ['CN-FUEL: 解析失败,未提取到省份油价数据'],
        meta: {
          apiCode: payload?.code ?? null,
          apiMessage: payload?.msg || payload?.message || null,
          rawSample: payload?.rawText?.slice(0, 200) || null,
        },
      };
    }

    const nationalAverage = computeNationalAverage(provinces);
    const signals = buildSignals(provinces, nationalAverage);

    // 全国均价最贵/最便宜省份 (92号)
    const benchmark = '92号汽油';
    const sorted92 = provinces
      .filter((p) => p.prices[benchmark] != null)
      .sort((a, b) => b.prices[benchmark] - a.prices[benchmark]);

    return {
      source: 'CN-Fuel',
      timestamp,
      endpoint: `${BASE}?id=24`,
      dataUpdatedAt: updatedAt,
      provinceCount: provinces.length,
      nationalAverage,
      items: provinces,
      signals,
      meta: {
        apiCode: payload?.code ?? null,
        fuelTypes: Object.values(FUEL_TYPES),
        highest92: sorted92[0]
          ? { province: sorted92[0].province, price: sorted92[0].prices[benchmark] }
          : null,
        lowest92: sorted92[sorted92.length - 1]
          ? {
              province: sorted92[sorted92.length - 1].province,
              price: sorted92[sorted92.length - 1].prices[benchmark],
            }
          : null,
      },
    };
  } catch (e) {
    return {
      source: 'CN-Fuel',
      timestamp,
      error: e.message,
      items: [],
      signals: [`CN-FUEL FETCH FAILED: ${e.message}`],
    };
  }
}

if (process.argv[1]?.endsWith('cn-fuel.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
