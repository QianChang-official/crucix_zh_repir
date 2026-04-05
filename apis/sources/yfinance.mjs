// Yahoo Finance — Live market quotes (no API key required)
// Provides real-time prices for stocks, ETFs, crypto, commodities
// Replaces the need for Alpaca or any paid market data provider

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const EASTMONEY_BASE = 'https://push2.eastmoney.com/api/qt';
const EASTMONEY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://quote.eastmoney.com/',
  'Accept': 'application/json,text/plain,*/*',
};
const EASTMONEY_BOARD_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';

const GROUPS = {
  indexes: ['^GSPC', '^IXIC', '^DJI', '^RUT'],
  asia: ['000001.SS', '000300.SS', '399001.SZ', '^HSI'],
  china: ['FXI', 'KWEB', 'ASHR'],
  rates: ['TLT', 'HYG', 'LQD'],
  commodities: ['GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F'],
  crypto: ['BTC-USD', 'ETH-USD'],
  volatility: ['^VIX'],
  fx: ['DX-Y.NYB'],
};

// Symbols to track — covers broad market, China/HK market, rates, commodities, crypto, volatility
const SYMBOLS = {
  // Global indexes
  '^GSPC': 'S&P 500',
  '^IXIC': 'Nasdaq Composite',
  '^DJI': 'Dow Jones',
  '^RUT': 'Russell 2000',
  // China / Hong Kong indexes
  '000001.SS': 'SSE Composite Index',
  '000300.SS': 'CSI 300 Index',
  '399001.SZ': 'Shenzhen Index',
  '^HSI': 'Hang Seng Index',
  // China thematic ETFs
  FXI: 'iShares China Large-Cap ETF',
  KWEB: 'KraneShares CSI China Internet ETF',
  ASHR: 'Xtrackers Harvest CSI 300 China A-Shares ETF',
  // Rates / Credit
  TLT: '20Y+ Treasury',
  HYG: 'High Yield Corp',
  LQD: 'IG Corporate',
  // Commodities
  'GC=F': 'Gold',
  'SI=F': 'Silver',
  'CL=F': 'WTI Crude',
  'BZ=F': 'Brent Crude',
  'NG=F': 'Natural Gas',
  // Crypto
  'BTC-USD': 'Bitcoin',
  'ETH-USD': 'Ethereum',
  // Volatility
  '^VIX': 'VIX',
  'DX-Y.NYB': 'Dollar Index',
};

let chinaCache = null;

function getChinaMarketClock(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour || 0) * 60 + Number(parts.minute || 0),
  };
}

function isChinaMarketSession(now = new Date()) {
  const { weekday, minutes } = getChinaMarketClock(now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return minutes >= 8 * 60 && minutes <= 15 * 60;
}

function getChinaCacheTtlMs(now = new Date()) {
  return isChinaMarketSession(now) ? 15 * 60 * 1000 : 2 * 60 * 60 * 1000;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toWanYi(value) {
  const numeric = toNumber(value);
  return numeric == null ? null : numeric / 10000;
}

function toYuanYi(value) {
  const numeric = toNumber(value);
  return numeric == null ? null : numeric / 1e8;
}

async function fetchEastmoneyJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${EASTMONEY_BASE}${path}`, {
      signal: controller.signal,
      headers: EASTMONEY_HEADERS,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return payload?.data || null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEastmoneyStock(entry) {
  if (!entry?.f12 || !entry?.f14) return null;
  return {
    code: String(entry.f12),
    name: String(entry.f14),
    price: toNumber(entry.f2),
    changePct: toNumber(entry.f3),
    mainNetIn: toNumber(entry.f62),
    mainNetInYi: toYuanYi(entry.f62),
    mainNetRatio: toNumber(entry.f184),
    pe: toNumber(entry.f127),
  };
}

function normalizeEastmoneyIndex(entry) {
  if (!entry?.f12 || !entry?.f14) return null;
  return {
    code: `${entry.f13}.${entry.f12}`,
    name: String(entry.f14),
    price: toNumber(entry.f2),
    changePct: toNumber(entry.f3),
  };
}

function normalizeNorthboundChannel(label, payload = {}) {
  return {
    label,
    status: toNumber(payload.status),
    date: payload.date2 || payload.date || null,
    dayNetAmtWan: toNumber(payload.dayNetAmtIn),
    dayNetAmtYi: toWanYi(payload.dayNetAmtIn),
    netBuyWan: toNumber(payload.netBuyAmt),
    netBuyYi: toWanYi(payload.netBuyAmt),
    turnoverWan: toNumber(payload.buySellAmt),
    turnoverYi: toWanYi(payload.buySellAmt),
  };
}

function buildChinaMonitorSignals(snapshot = {}) {
  const signals = [];
  const limitUpCount = snapshot.summary?.limitUpCount || 0;
  const limitDownCount = snapshot.summary?.limitDownCount || 0;
  const northboundNetYi = snapshot.summary?.northboundNetYi;
  const mainForceLead = snapshot.mainForce?.[0];

  if (limitUpCount >= 3) {
    signals.push(`A-SHARE MOMENTUM: tracked leaderboard shows ${limitUpCount} stocks up 10% or more`);
  }
  if (limitDownCount >= 3) {
    signals.push(`A-SHARE PRESSURE: tracked leaderboard shows ${limitDownCount} stocks down 10% or more`);
  }
  if (northboundNetYi != null && Math.abs(northboundNetYi) >= 10) {
    signals.push(`NORTHBOUND FLOW: ${northboundNetYi >= 0 ? '+' : ''}${northboundNetYi.toFixed(1)}亿 yuan across沪股通+深股通`);
  }
  if (mainForceLead?.mainNetInYi != null && Math.abs(mainForceLead.mainNetInYi) >= 1) {
    signals.push(`MAIN FORCE FLOW: ${mainForceLead.name} ${mainForceLead.mainNetInYi >= 0 ? 'absorbs' : 'loses'} ${Math.abs(mainForceLead.mainNetInYi).toFixed(2)}亿 yuan`);
  }

  return signals;
}

async function fetchEastmoneyChinaMonitor() {
  const fields = 'f12,f14,f2,f3,f62,f184,f225,f127,f128';
  const listQuery = extra => `/clist/get?pn=1&pz=8&np=1&fltt=2&fs=${encodeURIComponent(EASTMONEY_BOARD_FS)}&fields=${fields}${extra}`;

  const [topGainersResult, topLosersResult, mainForceResult, indexesResult, northboundResult] = await Promise.allSettled([
    fetchEastmoneyJson(`${listQuery('&fid=f3&po=1')}`),
    fetchEastmoneyJson(`${listQuery('&fid=f3&po=0')}`),
    fetchEastmoneyJson(`${listQuery('&fid=f62&po=1')}`),
    fetchEastmoneyJson('/ulist.np/get?fltt=2&fields=f14,f2,f3,f12,f13&secids=1.000001,0.399001,1.000300,1.000016'),
    fetchEastmoneyJson('/kamt/get?fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63'),
  ]);

  const topGainers = (topGainersResult.status === 'fulfilled' ? topGainersResult.value?.diff : [])
    ?.map(normalizeEastmoneyStock)
    .filter(Boolean) || [];
  const topLosers = (topLosersResult.status === 'fulfilled' ? topLosersResult.value?.diff : [])
    ?.map(normalizeEastmoneyStock)
    .filter(Boolean) || [];
  const mainForce = (mainForceResult.status === 'fulfilled' ? mainForceResult.value?.diff : [])
    ?.map(normalizeEastmoneyStock)
    .filter(Boolean) || [];
  const indexes = (indexesResult.status === 'fulfilled' ? indexesResult.value?.diff : [])
    ?.map(normalizeEastmoneyIndex)
    .filter(Boolean) || [];

  const northboundRaw = northboundResult.status === 'fulfilled' ? northboundResult.value : null;
  const northShanghai = normalizeNorthboundChannel('沪股通', northboundRaw?.hk2sh);
  const northShenzhen = normalizeNorthboundChannel('深股通', northboundRaw?.hk2sz);
  const southShanghai = normalizeNorthboundChannel('港股通沪', northboundRaw?.sh2hk);
  const southShenzhen = normalizeNorthboundChannel('港股通深', northboundRaw?.sz2hk);

  const northboundNetYi = [northShanghai.dayNetAmtYi, northShenzhen.dayNetAmtYi]
    .filter(value => value != null)
    .reduce((sum, value) => sum + value, 0);
  const southboundNetYi = [southShanghai.dayNetAmtYi, southShenzhen.dayNetAmtYi]
    .filter(value => value != null)
    .reduce((sum, value) => sum + value, 0);

  const summary = {
    strongestName: topGainers[0]?.name || null,
    strongestPct: topGainers[0]?.changePct ?? null,
    weakestName: topLosers[0]?.name || null,
    weakestPct: topLosers[0]?.changePct ?? null,
    mainForceLead: mainForce[0]?.name || null,
    limitUpCount: topGainers.filter(item => (item.changePct || 0) >= 9.8).length,
    limitDownCount: topLosers.filter(item => (item.changePct || 0) <= -9.8).length,
    northboundNetYi,
    southboundNetYi,
    date: northShanghai.date || northShenzhen.date || null,
  };

  const snapshot = {
    indexes,
    topGainers,
    topLosers,
    mainForce,
    northbound: {
      northShanghai,
      northShenzhen,
      southShanghai,
      southShenzhen,
      northboundNetYi,
      southboundNetYi,
      date: summary.date,
    },
    summary,
  };

  return {
    ...snapshot,
    signals: buildChinaMonitorSignals(snapshot),
  };
}

async function fetchQuote(symbol) {
  try {
    const url = `${BASE}/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
    const data = await safeFetch(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    const timestamps = result.timestamp || [];

    // Get current price and previous close
    const price = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2];
    const change = price && prevClose ? price - prevClose : 0;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    // Build 5-day history
    const history = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        history.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          close: Math.round(closes[i] * 100) / 100,
        });
      }
    }

    return {
      symbol,
      name: SYMBOLS[symbol] || meta.shortName || symbol,
      price: Math.round(price * 100) / 100,
      prevClose: Math.round((prevClose || 0) * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      currency: meta.currency || 'USD',
      exchange: meta.exchangeName || '',
      marketState: meta.marketState || 'UNKNOWN',
      history,
    };
  } catch (e) {
    return { symbol, name: SYMBOLS[symbol] || symbol, error: e.message };
  }
}

async function fetchBatch(symbols) {
  const results = await Promise.allSettled(symbols.map(symbol => fetchQuote(symbol)));

  const quotes = {};
  let ok = 0;
  let failed = 0;

  for (const result of results) {
    const quote = result.status === 'fulfilled' ? result.value : null;
    if (quote && !quote.error) {
      quotes[quote.symbol] = quote;
      ok++;
    } else {
      failed++;
      const symbol = quote?.symbol || 'unknown';
      quotes[symbol] = quote || { symbol, error: 'fetch failed' };
    }
  }

  return { quotes, ok, failed };
}

async function fetchChinaBatch() {
  const now = new Date();
  const ttlMs = getChinaCacheTtlMs(now);
  if (chinaCache && (now.getTime() - chinaCache.timestamp) < ttlMs) {
    return {
      ...chinaCache.data,
      cached: true,
      chinaMarketSession: chinaCache.chinaMarketSession,
      chinaCacheAgeMs: now.getTime() - chinaCache.timestamp,
    };
  }

  const symbols = [...GROUPS.asia, ...GROUPS.china];
  const [batch, chinaMonitor] = await Promise.all([
    fetchBatch(symbols),
    fetchEastmoneyChinaMonitor().catch(() => ({ indexes: [], topGainers: [], topLosers: [], mainForce: [], northbound: null, summary: {}, signals: [] })),
  ]);
  const chinaMarketSession = isChinaMarketSession(now);
  chinaCache = {
    timestamp: now.getTime(),
    chinaMarketSession,
    data: { ...batch, chinaMonitor },
  };

  return {
    ...batch,
    chinaMonitor,
    cached: false,
    chinaMarketSession,
    chinaCacheAgeMs: 0,
  };
}

function buildMarketSignals(quotes, chinaMonitor) {
  const signals = [];
  const vix = quotes['^VIX'];
  const dollarIndex = quotes['DX-Y.NYB'];

  if (vix && !vix.error && vix.price >= 25) {
    signals.push(`VOLATILITY WATCH: VIX at ${vix.price.toFixed(1)} with ${vix.changePct >= 0 ? '+' : ''}${vix.changePct}% daily move`);
  }
  if (dollarIndex && !dollarIndex.error && Math.abs(dollarIndex.changePct || 0) >= 0.5) {
    signals.push(`DOLLAR MOVE: DXY proxy ${dollarIndex.changePct >= 0 ? '+' : ''}${dollarIndex.changePct}%`);
  }
  for (const signal of chinaMonitor?.signals || []) signals.push(signal);

  return [...new Set(signals)];
}

export async function briefing() {
  return collect();
}

export async function collect() {
  const coreSymbols = [
    ...GROUPS.indexes,
    ...GROUPS.rates,
    ...GROUPS.commodities,
    ...GROUPS.crypto,
    ...GROUPS.volatility,
    ...GROUPS.fx,
  ];

  const [coreBatch, chinaBatch] = await Promise.all([
    fetchBatch(coreSymbols),
    fetchChinaBatch(),
  ]);

  const quotes = {
    ...coreBatch.quotes,
    ...chinaBatch.quotes,
  };
  const ok = coreBatch.ok + chinaBatch.ok;
  const failed = coreBatch.failed + chinaBatch.failed;
  const totalSymbols = coreSymbols.length + GROUPS.asia.length + GROUPS.china.length;
  const signals = buildMarketSignals(quotes, chinaBatch.chinaMonitor);

  // Categorize for easy dashboard consumption
  return {
    quotes,
    signals,
    summary: {
      totalSymbols,
      ok,
      failed,
      timestamp: new Date().toISOString(),
      chinaMarketSession: chinaBatch.chinaMarketSession,
      chinaCacheAgeMs: chinaBatch.chinaCacheAgeMs,
      chinaCached: chinaBatch.cached,
    },
    indexes: pickGroup(quotes, GROUPS.indexes),
    asia: pickGroup(quotes, GROUPS.asia),
    china: pickGroup(quotes, GROUPS.china),
    rates: pickGroup(quotes, GROUPS.rates),
    commodities: pickGroup(quotes, GROUPS.commodities),
    crypto: pickGroup(quotes, GROUPS.crypto),
    volatility: pickGroup(quotes, GROUPS.volatility),
    fx: pickGroup(quotes, GROUPS.fx),
    chinaMonitor: chinaBatch.chinaMonitor,
  };
}

function pickGroup(quotes, symbols) {
  return symbols.map(s => quotes[s]).filter(Boolean);
}
