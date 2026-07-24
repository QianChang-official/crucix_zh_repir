// Tmini.net Gold Price API (apidoc id=39) — real-time precious metals pricing
// Endpoint: https://tmini.net/api/gold-price?type=json
// Provides: 今日金价 / 国际金价 (伦敦金/纽约黄金) / 白银 / 铂金 / 钯金
//           品牌金店金价 (周大福/老凤祥/…) / 银行投资金条 / 黄金回收价
// No auth required. Browser UA needed.
//
// Note: the API exposes today_price (daily reference) + sell_price (live) + high/low,
// but no explicit previous close. We compute:
//   movePct      = (sell - today) / today * 100   (change vs daily reference)
//   amplitudePct = (high - low)  / low   * 100   (intraday range)
// The >2% signal fires on amplitudePct (most reliable significant-move proxy).

const BASE = 'https://tmini.net/api/gold-price?type=json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
// Referer + browser UA reduce the chance of triggering tmini's anti-bot guard (HTTP 456).
const HEADERS = {
  'User-Agent': UA,
  Referer: 'https://www.tmini.net/',
  Accept: 'application/json,text/plain,*/*',
};

// Metals tracked for the >2% move signal
const WATCHED_METALS = new Set([
  '今日金价', '黄金价格', '黄金_9999', '黄金_T+D',
  '伦敦金(现货黄金)', '纽约黄金(美国)',
  '白银价格', '铂金价格', '钯金价格',
]);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctChange(from, to) {
  const a = toNumber(from);
  const b = toNumber(to);
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / a) * 100;
}

function normalizeMetal(m) {
  const today = toNumber(m.today_price);
  const sell = toNumber(m.sell_price);
  const high = toNumber(m.high_price);
  const low = toNumber(m.low_price);
  return {
    name: m.name,
    sellPrice: sell,
    todayPrice: today,
    highPrice: high,
    lowPrice: low,
    unit: m.unit,
    movePct: pctChange(today, sell),
    amplitudePct: pctChange(low, high),
    updated: m.updated || null,
    updatedAt: m.updated_at ? new Date(Number(m.updated_at)).toISOString() : null,
  };
}

function normalizeStore(s) {
  return {
    brand: s.brand || s.bank || null,
    product: s.product || null,
    price: toNumber(s.price),
    unit: s.unit || null,
    formatted: s.formatted || null,
    updated: s.updated || null,
    updatedAt: s.updated_at ? new Date(Number(s.updated_at)).toISOString() : null,
  };
}

function normalizeRecycle(r) {
  return {
    type: r.type || null,
    price: toNumber(r.price),
    unit: r.unit || null,
    purity: r.purity || null,
    formatted: r.formatted || null,
    updated: r.updated || null,
    updatedAt: r.updated_at ? new Date(Number(r.updated_at)).toISOString() : null,
  };
}

async function fetchGold() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(BASE, { signal: controller.signal, headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildSignals(metals) {
  const signals = [];
  const watched = metals.filter(m => WATCHED_METALS.has(m.name));

  for (const m of watched) {
    if (m.amplitudePct != null && Math.abs(m.amplitudePct) >= 2) {
      const dir = m.movePct >= 0 ? 'up' : 'down';
      signals.push(`GOLD MOVE: ${m.name} intraday range ${m.amplitudePct.toFixed(2)}% (${dir} ${m.movePct?.toFixed(2)}% vs ref) — low ${m.lowPrice} → high ${m.highPrice} ${m.unit}`);
    } else if (m.movePct != null && Math.abs(m.movePct) >= 2) {
      signals.push(`GOLD MOVE: ${m.name} ${m.movePct >= 0 ? '+' : ''}${m.movePct.toFixed(2)}% vs daily reference (${m.unit})`);
    }
  }

  // Spot benchmark — 今日金价
  const todayGold = metals.find(m => m.name === '今日金价');
  if (todayGold && todayGold.sellPrice != null) {
    signals.push(`GOLD BENCHMARK: 今日金价 ${todayGold.sellPrice} ${todayGold.unit} (ref ${todayGold.todayPrice}, range ${todayGold.lowPrice}–${todayGold.highPrice})`);
  }

  return signals;
}

export async function briefing() {
  let payload;
  try {
    payload = await fetchGold();
  } catch (e) {
    return {
      source: 'Gold-Price',
      timestamp: new Date().toISOString(),
      endpoint: BASE,
      error: e.message,
      metals: [],
      stores: [],
      banks: [],
      recycle: [],
      signals: [`GOLD-PRICE FETCH FAILED: ${e.message}`],
    };
  }

  if (!payload || typeof payload !== 'object') {
    return {
      source: 'Gold-Price',
      timestamp: new Date().toISOString(),
      endpoint: BASE,
      error: 'invalid payload',
      metals: [],
      stores: [],
      banks: [],
      recycle: [],
      signals: ['GOLD-PRICE: invalid payload returned'],
    };
  }

  const metals = Array.isArray(payload.metals) ? payload.metals.map(normalizeMetal) : [];
  const stores = Array.isArray(payload.stores) ? payload.stores.map(normalizeStore) : [];
  const banks = Array.isArray(payload.banks) ? payload.banks.map(normalizeStore) : [];
  const recycle = Array.isArray(payload.recycle) ? payload.recycle.map(normalizeRecycle) : [];
  const signals = buildSignals(metals);

  const todayGold = metals.find(m => m.name === '今日金价');
  const londonGold = metals.find(m => /伦敦金/.test(m.name));

  return {
    source: 'Gold-Price',
    timestamp: new Date().toISOString(),
    endpoint: BASE,
    date: payload.date || null,
    metals,
    stores,
    banks,
    recycle,
    summary: {
      metalsCount: metals.length,
      storesCount: stores.length,
      banksCount: banks.length,
      recycleCount: recycle.length,
      todayGoldPrice: todayGold?.sellPrice ?? null,
      todayGoldUnit: todayGold?.unit ?? null,
      londonGoldPrice: londonGold?.sellPrice ?? null,
      londonGoldUnit: londonGold?.unit ?? null,
      movesOver2pct: metals.filter(m => m.amplitudePct != null && Math.abs(m.amplitudePct) >= 2).length,
    },
    signals,
  };
}

if (process.argv[1]?.endsWith('gold-price.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
