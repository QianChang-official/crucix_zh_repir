// Tmini.net Stock API (apidoc id=14) — A-share real-time quotes
// Endpoint: https://tmini.net/api/stock?exchange={exchange}&code={code}
// Provides 上证/深证/北证50 指数 + 个股 实时行情
//   (开高低收 / 涨跌幅 / 成交量 / 成交额 / 委比 / 量比 / 换手率 / 主力净流入)
// No auth required. Browser UA needed (default Crucix UA is blocked).
//
// Exchange codes: 101=上证, 105=深证, 106=北证(partial coverage — 北证50 may 404)
// Price scaling: prices are in the smallest currency unit; divide by 10^price_base.
//   price_base=2 → divide by 100 (i.e. cents → yuan).
// roc / amp are basis points (divide by 100 for %).
// amount is in 分 (cents): amountYuan = amount / 10^price_base, amountYi = amountYuan / 1e8.

const BASE = 'https://tmini.net/api/stock';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
// Referer + browser UA reduce the chance of triggering tmini's anti-bot guard (HTTP 456).
// The platform enforces QPS≈5, so we also cap concurrency and stagger requests.
const HEADERS = {
  'User-Agent': UA,
  Referer: 'https://www.tmini.net/',
  Accept: 'application/json,text/plain,*/*',
};

// Run async map with bounded concurrency + stagger to stay under the QPS limit.
async function mapWithConcurrency(items, limit, staggerMs, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      if (staggerMs > 0) await new Promise(r => setTimeout(r, staggerMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Index watchlist — 上证/深证/北证50 + broad-market benchmarks
const INDEXES = [
  { exchange: 101, code: '000001', name: '上证指数' },
  { exchange: 105, code: '399001', name: '深证成指' },
  { exchange: 101, code: '000300', name: '沪深300' },
  { exchange: 101, code: '000016', name: '上证50' },
  // 北证50 — API coverage is partial; often returns 404. Fetched defensively.
  { exchange: 106, code: '899050', name: '北证50' },
];

// Representative large-caps across boards (上证主板 / 深证主板 / 中小板 / 创业板)
const STOCKS = [
  { exchange: 101, code: '600519', name: '贵州茅台' },
  { exchange: 101, code: '601318', name: '中国平安' },
  { exchange: 101, code: '600036', name: '招商银行' },
  { exchange: 105, code: '000001', name: '平安银行' },
  { exchange: 105, code: '002594', name: '比亚迪' },
  { exchange: 105, code: '300750', name: '宁德时代' },
];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scalePrice(value, priceBase) {
  const n = toNumber(value);
  if (n == null) return null;
  const base = Number(priceBase) || 0;
  return n / Math.pow(10, base);
}

function bpToPct(value) {
  // basis points (0.01%) → percentage
  const n = toNumber(value);
  return n == null ? null : n / 100;
}

function amountToYi(value, priceBase) {
  // amount is in 分; yuan = amount / 10^price_base; 亿 = yuan / 1e8
  const n = toNumber(value);
  if (n == null) return null;
  const base = Number(priceBase) || 0;
  return n / Math.pow(10, base) / 1e8;
}

function parseQuoteTime(value) {
  // Format: YYYYMMDDHHmmss[mmm] (e.g. 20260724153500000)
  const s = String(value || '');
  if (s.length < 14) return null;
  const y = s.slice(0, 4);
  const mo = s.slice(4, 6);
  const d = s.slice(6, 8);
  const h = s.slice(8, 10);
  const mi = s.slice(10, 12);
  const se = s.slice(12, 14);
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}+08:00`);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

function normalizeQuote(meta, root) {
  const priceBase = root.price_base;
  const q = root.data || {};
  const info = root.info || {};
  const stockInfo = info.stock || {};
  const extra = q.stock || {};
  const offline = q.offline || {};

  return {
    ...meta,
    name: info.name || meta.name,
    industry: stockInfo.industry_sector_info?.name || null,
    price: scalePrice(q.now, priceBase),
    prevClose: scalePrice(q.pclose, priceBase),
    open: scalePrice(q.open, priceBase),
    high: scalePrice(q.high, priceBase),
    low: scalePrice(q.low, priceBase),
    avg: scalePrice(q.avg, priceBase),
    change: scalePrice(q.change, priceBase),
    changePct: bpToPct(q.roc),
    amplitudePct: bpToPct(q.amp),
    volume: toNumber(q.volume),
    amount: toNumber(q.amount),
    amountYi: amountToYi(q.amount, priceBase),
    turnoverRatePct: bpToPct(extra.turnover_rate),
    volumeRatio: toNumber(extra.volume_ratio) != null ? extra.volume_ratio / 10000 : null,
    peTtm: toNumber(extra.pe_ttm) != null ? extra.pe_ttm / 100 : null,
    pb: toNumber(extra.pb) != null ? extra.pb / 100 : null,
    mainNetInflow: toNumber(extra.cittdiff),
    mainNetInflowRatioPct: bpToPct(extra.cittthan),
    bidSize: toNumber(extra.bid_size),
    askSize: toNumber(extra.ask_size),
    priceUpperLimit: scalePrice(stockInfo.price_upper_limit, priceBase),
    priceLowerLimit: scalePrice(stockInfo.price_low_limit, priceBase),
    continueRiseDay: toNumber(offline.continue_rise_day),
    roc5dPct: bpToPct(offline.roc_recent_5d),
    roc1mPct: bpToPct(offline.roc_recent_1m),
    marketStatus: toNumber(q.market_status),
    tradingStatus: toNumber(q.trading_status),
    updatedAt: parseQuoteTime(q.time),
  };
}

async function fetchQuote(meta) {
  const url = `${BASE}?exchange=${meta.exchange}&code=${encodeURIComponent(meta.code)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (payload?.code !== 200 || !payload?.data) {
      return { ...meta, error: payload?.message || 'no data' };
    }
    return normalizeQuote(meta, payload.data);
  } catch (e) {
    return { ...meta, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function buildSignals(quotes) {
  const signals = [];
  const ok = quotes.filter(q => q && !q.error);
  const indexes = ok.filter(q => INDEXES.some(i => i.code === q.code && i.exchange === q.exchange));
  const stocks = ok.filter(q => !INDEXES.some(i => i.code === q.code && i.exchange === q.exchange));

  // Index moves ≥ 1%
  for (const idx of indexes) {
    if (idx.changePct == null) continue;
    const sign = idx.changePct >= 0 ? '+' : '';
    if (Math.abs(idx.changePct) >= 1) {
      signals.push(`A-SHARE INDEX MOVE: ${idx.name} ${sign}${idx.changePct.toFixed(2)}% @ ${idx.price?.toFixed(2)} (amt ${idx.amountYi?.toFixed(0)}亿)`);
    }
  }

  // Limit-up / limit-down (watchlist scope — 10% board threshold; 创业板/科创板 limit is 20%)
  const limitUp = stocks.filter(s => (s.changePct || 0) >= 9.8);
  const limitDown = stocks.filter(s => (s.changePct || 0) <= -9.8);
  if (limitUp.length) {
    signals.push(`A-SHARE LIMIT-UP (watchlist ${stocks.length}): ${limitUp.length} — ${limitUp.map(s => `${s.name} +${s.changePct.toFixed(1)}%`).join(', ')}`);
  }
  if (limitDown.length) {
    signals.push(`A-SHARE LIMIT-DOWN (watchlist ${stocks.length}): ${limitDown.length} — ${limitDown.map(s => `${s.name} ${s.changePct.toFixed(1)}%`).join(', ')}`);
  }

  // Market breadth from watchlist
  if (stocks.length) {
    const advancers = stocks.filter(s => (s.changePct || 0) > 0).length;
    const decliners = stocks.filter(s => (s.changePct || 0) < 0).length;
    const flat = stocks.length - advancers - decliners;
    signals.push(`A-SHARE BREADTH (watchlist ${stocks.length}): ${advancers} up / ${decliners} down / ${flat} flat`);
  }

  return signals;
}

export async function briefing() {
  const watchlist = [
    ...INDEXES.map(i => ({ ...i, kind: 'index' })),
    ...STOCKS.map(s => ({ ...s, kind: 'stock' })),
  ];

  // Concurrency 2 + 250ms stagger keeps us safely under tmini's QPS≈5 and avoids the 456 anti-bot guard.
  const quotes = await mapWithConcurrency(watchlist, 2, 250, fetchQuote);

  const ok = quotes.filter(q => !q.error);
  const failed = quotes.length - ok.length;
  const indexes = ok.filter(q => q.kind === 'index');
  const stocks = ok.filter(q => q.kind === 'stock');
  const signals = buildSignals(quotes);

  const summary = {
    total: watchlist.length,
    ok: ok.length,
    failed,
    indexCount: indexes.length,
    stockCount: stocks.length,
    limitUpCount: stocks.filter(s => (s.changePct || 0) >= 9.8).length,
    limitDownCount: stocks.filter(s => (s.changePct || 0) <= -9.8).length,
    advancers: stocks.filter(s => (s.changePct || 0) > 0).length,
    decliners: stocks.filter(s => (s.changePct || 0) < 0).length,
    strongest: stocks.length ? stocks.reduce((a, b) => ((b.changePct || -Infinity) > (a.changePct || -Infinity) ? b : a)).name : null,
    weakest: stocks.length ? stocks.reduce((a, b) => ((b.changePct || Infinity) < (a.changePct || Infinity) ? b : a)).name : null,
  };

  return {
    source: 'CN-Stock',
    timestamp: new Date().toISOString(),
    endpoint: BASE,
    indexes,
    stocks,
    summary,
    signals,
  };
}

if (process.argv[1]?.endsWith('cn-stock.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
