// Yahoo Finance — Live market quotes (no API key required)
// Provides real-time prices for stocks, ETFs, crypto, commodities
// Replaces the need for Alpaca or any paid market data provider

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const GROUPS = {
  indexes: ['^GSPC', '^IXIC', '^DJI', '^RUT'],
  asia: ['000001.SS', '000300.SS', '399001.SZ', '^HSI'],
  china: ['FXI', 'KWEB', 'ASHR'],
  rates: ['TLT', 'HYG', 'LQD'],
  commodities: ['GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F'],
  crypto: ['BTC-USD', 'ETH-USD'],
  volatility: ['^VIX'],
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
  const batch = await fetchBatch(symbols);
  const chinaMarketSession = isChinaMarketSession(now);
  chinaCache = {
    timestamp: now.getTime(),
    chinaMarketSession,
    data: batch,
  };

  return {
    ...batch,
    cached: false,
    chinaMarketSession,
    chinaCacheAgeMs: 0,
  };
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

  // Categorize for easy dashboard consumption
  return {
    quotes,
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
  };
}

function pickGroup(quotes, symbols) {
  return symbols.map(s => quotes[s]).filter(Boolean);
}
