// FRED — Federal Reserve Economic Data
// 840,000+ time series. Free API key required.
// Key indicators: yield curve, CPI, unemployment, money supply, GDP, fed funds rate

import { safeFetch, daysAgo } from '../utils/fetch.mjs';

const BASE = 'https://api.stlouisfed.org/fred';
const CSV_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

// Key series IDs for macro intelligence
const KEY_SERIES = {
  // Yield curve & rates
  DFF: 'Fed Funds Rate',
  DGS2: '2-Year Treasury Yield',
  DGS10: '10-Year Treasury Yield',
  DGS30: '30-Year Treasury Yield',
  T10Y2Y: '10Y-2Y Spread (Yield Curve)',
  T10Y3M: '10Y-3M Spread',
  // Inflation
  CPIAUCSL: 'CPI All Items',
  CPILFESL: 'Core CPI (ex Food & Energy)',
  PCEPI: 'PCE Price Index',
  MICH: 'Michigan Inflation Expectations',
  // Labor
  UNRATE: 'Unemployment Rate',
  PAYEMS: 'Nonfarm Payrolls',
  ICSA: 'Initial Jobless Claims',
  // Money & credit
  M2SL: 'M2 Money Supply',
  WALCL: 'Fed Balance Sheet Total Assets',
  // Fear gauges
  VIXCLS: 'VIX (Fear Index)',
  BAMLH0A0HYM2: 'High Yield Spread (Credit Stress)',
  // Commodities via FRED
  DCOILWTICO: 'WTI Crude Oil',
  GOLDAMGBD228NLBM: 'Gold Price (London Fix)',
  // Housing
  MORTGAGE30US: '30-Year Mortgage Rate',
  // Global
  DTWEXBGS: 'USD Trade Weighted Index',
};

// Get latest value for a series
async function getSeriesLatest(seriesId, apiKey) {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: '5',
    observation_start: daysAgo(90),
  });
  return safeFetch(`${BASE}/series/observations?${params}`);
}

async function fetchTextWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Crucix/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseFredCsv(csvText) {
  const rows = csvText
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const commaIndex = line.indexOf(',');
      if (commaIndex < 0) return null;
      return {
        date: line.slice(0, commaIndex).trim(),
        value: line.slice(commaIndex + 1).trim(),
      };
    })
    .filter(Boolean);

  const valid = rows.filter(row => row.value && row.value !== '.');
  const latest = valid.at(-1) || null;
  const recent = valid.slice(-5).reverse().map(row => Number.parseFloat(row.value));

  return {
    latest,
    recent,
  };
}

async function getSeriesLatestFromCsv(seriesId) {
  const params = new URLSearchParams({
    id: seriesId,
    cosd: daysAgo(3650),
  });
  const csvText = await fetchTextWithTimeout(`${CSV_BASE}?${params}`);
  return parseFredCsv(csvText);
}

async function getSeriesSnapshot(seriesId, label, apiKey) {
  const fromCsv = async () => {
    const csvData = await getSeriesLatestFromCsv(seriesId);
    return {
      id: seriesId,
      label,
      value: csvData.latest ? Number.parseFloat(csvData.latest.value) : null,
      date: csvData.latest?.date || null,
      recent: csvData.recent,
      transport: 'fredgraph-csv',
    };
  };

  if (!apiKey) return fromCsv();

  const data = await getSeriesLatest(seriesId, apiKey);
  const obs = data?.observations;
  if (!data?.error && Array.isArray(obs) && obs.length) {
    const latest = obs.find(o => o.value !== '.');
    const validObs = obs.filter(o => o.value !== '.');
    return {
      id: seriesId,
      label,
      value: latest ? Number.parseFloat(latest.value) : null,
      date: latest?.date || null,
      recent: validObs.slice(0, 5).map(o => Number.parseFloat(o.value)),
      transport: 'fred-api',
    };
  }

  return fromCsv();
}

// Briefing — pull all key indicators
export async function briefing(apiKey) {
  const entries = Object.entries(KEY_SERIES);
  const results = await Promise.all(
    entries.map(async ([id, label]) => {
      try {
        return await getSeriesSnapshot(id, label, apiKey);
      } catch {
        return { id, label, value: null, date: null, recent: [], transport: 'unavailable' };
      }
    })
  );

  const availableResults = results.filter(result => result.value !== null);
  if (!availableResults.length) {
    return {
      source: 'FRED',
      timestamp: new Date().toISOString(),
      error: 'FRED API and fredgraph CSV fallback both returned no usable series',
      hint: 'Check outbound access to api.stlouisfed.org and fred.stlouisfed.org',
    };
  }

  // Compute derived signals
  const get = (id) => results.find(r => r.id === id)?.value;
  const yieldCurve10y2y = get('T10Y2Y');
  const yieldCurve10y3m = get('T10Y3M');
  const vix = get('VIXCLS');
  const hySpread = get('BAMLH0A0HYM2');

  const signals = [];
  if (yieldCurve10y2y !== null && yieldCurve10y2y < 0) signals.push('YIELD CURVE INVERTED (10Y-2Y) — recession signal');
  if (yieldCurve10y3m !== null && yieldCurve10y3m < 0) signals.push('YIELD CURVE INVERTED (10Y-3M) — stronger recession signal');
  if (vix !== null && vix > 30) signals.push(`VIX ELEVATED at ${vix} — high fear/volatility`);
  if (vix !== null && vix > 40) signals.push(`VIX EXTREME at ${vix} — crisis-level fear`);
  if (hySpread !== null && hySpread > 5) signals.push(`HIGH YIELD SPREAD WIDE at ${hySpread}% — credit stress`);

  return {
    source: 'FRED',
    timestamp: new Date().toISOString(),
    mode: apiKey ? 'api+csv-fallback' : 'csv-fallback',
    indicators: availableResults,
    signals,
  };
}

if (process.argv[1]?.endsWith('fred.mjs')) {
  const data = await briefing(process.env.FRED_API_KEY);
  console.log(JSON.stringify(data, null, 2));
}
