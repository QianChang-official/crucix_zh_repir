// 百度财经热搜数据源
// 使用 uapis.cn hotboard API (type=baidu) 获取百度热搜榜
// 备选: finance.baidu.com / top.baidu.com/board?tab=finance (需爬取)
// uapis.cn 聚合接口返回结构化 JSON,稳定性最佳
// 信号: 涉及股票/制裁/能源/汇率/关税的财经热点

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const BASE = 'https://api.uapis.cn/api/hotboard';

// 财经相关关键词 —— 用于从通用热搜中筛选财经类条目并产生信号
const FINANCE_KEYWORDS = /股票|A股|港股|美股|基金|债券|期货|大盘|涨停|跌停|熊市|牛市|上证|深证|创业板|科创板|北证|茅台|宁德|比亚迪|平安|招商|制裁|关税|贸易战|出口|进口|芯片|半导体|新能源|光伏|储能|锂电|稀土|铜|铁矿石|螺纹钢|原油|油价|天然气|煤炭|电力|汇率|人民币|美元|欧元|日元|黄金|白银|通胀|CPI|PPI|PMI|GDP|降息|加息|MLF|LPR|社融|M2|外储|地产|楼市|房贷|城投|地方债|消费|零售|出口|外企|FDI|并购|IPO|上市|退市|回购|增持|减持|质押|商誉|业绩|财报|分红|派息|限售|解禁/i;

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json,text/plain,*/*',
        'Referer': 'https://api.uapis.cn/',
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

// uapis.cn hotboard 返回格式不固定,做兼容解析
function parseHotItems(payload) {
  if (!payload) return [];
  // 常见字段: data / list / items
  const list =
    payload.data?.list ||
    payload.data?.items ||
    payload.data ||
    payload.list ||
    payload.items ||
    [];
  if (!Array.isArray(list)) return [];

  return list
    .map((entry, idx) => {
      if (!entry || typeof entry !== 'object') return null;
      const title = String(entry.title || entry.name || entry.word || entry.query || '').trim();
      if (!title) return null;
      const hot =
        Number(entry.hot || entry.hotScore || entry.score || entry.heat || entry.index || 0) || 0;
      const url =
        String(entry.url || entry.link || entry.redirect_url || entry.jump_url || '').trim() ||
        null;
      const rank = Number(entry.rank || idx + 1) || idx + 1;
      const tag = entry.tag || entry.label || entry.category || null;
      const desc = String(entry.desc || entry.description || entry.abstract || '').trim() || null;
      return { title, hot, url, rank, tag, desc };
    })
    .filter(Boolean);
}

function buildSignals(items) {
  const signals = [];
  if (!items.length) {
    signals.push('BAIDU HOT: 热搜榜为空或解析失败');
    return signals;
  }

  // 财经相关条目
  const financeItems = items.filter(
    (i) => FINANCE_KEYWORDS.test(i.title) || (i.desc && FINANCE_KEYWORDS.test(i.desc))
  );
  if (financeItems.length) {
    const top3 = financeItems.slice(0, 3).map((i) => `「${i.title}」`).join(' ');
    signals.push(`BAIDU FINANCE HOT: 热搜榜检测到 ${financeItems.length} 条财经相关条目 — ${top3}`);
  }

  // 制裁 / 贸易战 / 关税
  const sanctionItems = items.filter((i) =>
    /制裁|关税|贸易战|出口管制|实体清单|封锁|禁运/i.test(`${i.title} ${i.desc || ''}`)
  );
  if (sanctionItems.length) {
    signals.push(
      `BAIDU SANCTIONS WATCH: ${sanctionItems.length} 条涉及制裁/关税/贸易战 — ${sanctionItems
        .map((i) => i.title)
        .slice(0, 3)
        .join(' | ')}`
    );
  }

  // 能源价格
  const energyItems = items.filter((i) =>
    /原油|油价|天然气|煤炭|电力|OPEC|沙特|俄罗斯|管道|LNG|储能|光伏|锂电/i.test(
      `${i.title} ${i.desc || ''}`
    )
  );
  if (energyItems.length) {
    signals.push(
      `BAIDU ENERGY WATCH: ${energyItems.length} 条涉及能源/原油/新能源 — ${energyItems
        .map((i) => i.title)
        .slice(0, 3)
        .join(' | ')}`
    );
  }

  // 股市异动信号
  const stockItems = items.filter((i) =>
    /A股|大盘|涨停|跌停|牛市|熊市|股灾|暴跌|暴涨|千股|熔断/i.test(`${i.title} ${i.desc || ''}`)
  );
  if (stockItems.length) {
    signals.push(
      `BAIDU STOCK MOVE: ${stockItems.length} 条涉及股市异动 — ${stockItems
        .map((i) => i.title)
        .join(' | ')}`
    );
  }

  // Top 1 登顶
  if (items[0]) {
    signals.push(`BAIDU HOT #1: 「${items[0].title}」(热度 ${items[0].hot})`);
  }

  return signals;
}

export async function briefing() {
  const timestamp = new Date().toISOString();
  try {
    const payload = await fetchWithTimeout(`${BASE}?type=baidu`);
    const items = parseHotItems(payload);
    const signals = buildSignals(items);

    return {
      source: 'Baidu-Finance-Hot',
      timestamp,
      endpoint: `${BASE}?type=baidu`,
      platform: 'baidu',
      count: items.length,
      items: items.slice(0, 20),
      topTitle: items[0]?.title || null,
      signals,
      meta: {
        apiCode: payload?.code ?? null,
        apiMessage: payload?.msg || payload?.message || null,
        financeRelated: items.filter(
          (i) => FINANCE_KEYWORDS.test(i.title) || (i.desc && FINANCE_KEYWORDS.test(i.desc))
        ).length,
      },
    };
  } catch (e) {
    return {
      source: 'Baidu-Finance-Hot',
      timestamp,
      error: e.message,
      items: [],
      signals: [`BAIDU HOT FETCH FAILED: ${e.message}`],
    };
  }
}

if (process.argv[1]?.endsWith('baidu-finance-hot.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
