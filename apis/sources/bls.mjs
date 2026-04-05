// BLS — Bureau of Labor Statistics
// CPI, unemployment, nonfarm payrolls, PPI. No auth required (v1 API).
// v2 with registration key supports more requests; v1 is rate-limited but functional.

import { safeFetch } from '../utils/fetch.mjs';

const V1_BASE = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const V2_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const FRED_CSV_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

// Key economic series
const SERIES = {
  'CUUR0000SA0':    'CPI-U All Items',
  'CUUR0000SA0L1E': 'CPI-U Core (ex Food & Energy)',
  'LNS14000000':    'Unemployment Rate',
  'CES0000000001':  'Nonfarm Payrolls (thousands)',
  'WPUFD49104':     'PPI Final Demand',
};

const FRED_FALLBACK_SERIES = {
  CUUR0000SA0: 'CPIAUCSL',
  CUUR0000SA0L1E: 'CPILFESL',
  LNS14000000: 'UNRATE',
  CES0000000001: 'PAYEMS',
  WPUFD49104: 'PPIACO',
};

// Fetch a single series via GET (v1, no key needed)
export async function getSeriesV1(seriesId) {
  return safeFetch(`${V1_BASE}/${seriesId}`);
}

// Fetch one or more series via POST (v2 if key available, v1 otherwise)
export async function getSeries(seriesIds, opts = {}) {
  const { startYear, endYear, apiKey } = opts;
  const now = new Date();
  const start = startYear || String(now.getFullYear() - 1);
  const end = endYear || String(now.getFullYear());

  const base = apiKey ? V2_BASE : V1_BASE;
  const payload = {
    seriesid: Array.isArray(seriesIds) ? seriesIds : [seriesIds],
    startyear: start,
    endyear: end,
  };
  if (apiKey) payload.registrationkey = apiKey;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function fetchTextWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/csv,text/plain,*/*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseFredCsvObservations(csvText) {
  return String(csvText || '')
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const commaIndex = line.indexOf(',');
      if (commaIndex < 0) return null;
      const date = line.slice(0, commaIndex).trim();
      const rawValue = line.slice(commaIndex + 1).trim();
      const value = Number.parseFloat(rawValue);
      if (!date || rawValue === '.' || !Number.isFinite(value)) return null;
      return { date, value };
    })
    .filter(Boolean);
}

function buildIndicatorFromObservations(id, label, observations = []) {
  const valid = observations.filter(entry => Number.isFinite(entry.value));
  if (!valid.length) return { id, label, value: null, date: null, momChange: null, momChangePct: null };

  const latest = valid[valid.length - 1];
  const previous = valid.length > 1 ? valid[valid.length - 2] : null;
  const change = previous ? +(latest.value - previous.value).toFixed(4) : null;
  const changePct = previous && previous.value !== 0
    ? +(((latest.value - previous.value) / previous.value) * 100).toFixed(4)
    : null;

  return {
    id,
    label,
    value: latest.value,
    period: latest.date,
    date: latest.date,
    momChange: change,
    momChangePct: changePct,
  };
}

function buildSignalsFromIndicators(indicators = []) {
  const get = id => indicators.find(indicator => indicator.id === id);
  const unemployment = get('LNS14000000');
  const cpi = get('CUUR0000SA0');
  const coreCpi = get('CUUR0000SA0L1E');
  const payrolls = get('CES0000000001');
  const signals = [];

  if ((unemployment?.value ?? 0) > 5.0) {
    signals.push(`Unemployment elevated at ${unemployment.value}%`);
  }
  if ((cpi?.momChangePct ?? 0) > 0.4) {
    signals.push(`CPI-U MoM jump: ${cpi.momChangePct}%`);
  }
  if ((coreCpi?.momChangePct ?? 0) > 0.3) {
    signals.push(`Core CPI MoM rising: ${coreCpi.momChangePct}%`);
  }
  if ((payrolls?.momChange ?? 0) < -50) {
    signals.push(`Nonfarm payrolls dropped by ${Math.abs(payrolls.momChange)}K`);
  }

  return signals;
}

async function getFredFallbackIndicators() {
  const entries = Object.entries(FRED_FALLBACK_SERIES);
  const results = await Promise.all(entries.map(async ([id, fredId]) => {
    try {
      const params = new URLSearchParams({ id: fredId, cosd: '2018-01-01' });
      const csvText = await fetchTextWithTimeout(`${FRED_CSV_BASE}?${params}`);
      const observations = parseFredCsvObservations(csvText);
      return buildIndicatorFromObservations(id, SERIES[id] || id, observations);
    } catch {
      return { id, label: SERIES[id] || id, value: null, date: null, momChange: null, momChangePct: null };
    }
  }));

  return results.filter(result => result.value != null);
}

async function buildFredFallbackBriefing(reason) {
  const indicators = await getFredFallbackIndicators();
  if (!indicators.length) return null;

  return {
    source: 'BLS',
    timestamp: new Date().toISOString(),
    mode: 'fred-csv-fallback',
    stale: true,
    note: `BLS unavailable, using FRED CSV fallback: ${reason}`,
    indicators,
    signals: buildSignalsFromIndicators(indicators),
  };
}

// Extract the latest observation from a BLS series response
function latestFromSeries(seriesData) {
  if (!seriesData?.data?.length) return null;
  // BLS returns data sorted by year desc, period desc
  // Filter out unavailable values (BLS uses "-" for missing data)
  const valid = seriesData.data.filter(d => d.value !== '-' && d.value !== '.');
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => {
    const ya = parseInt(a.year), yb = parseInt(b.year);
    if (ya !== yb) return yb - ya;
    // period is M01..M12 or M13 (annual avg) or Q01..Q05
    return b.period.localeCompare(a.period);
  });
  return sorted[0];
}

// Get the two most recent observations to compute month-over-month change
function momChange(seriesData) {
  if (!seriesData?.data?.length || seriesData.data.length < 2) return null;
  const sorted = [...seriesData.data]
    .filter(d => d.period.startsWith('M') && d.period !== 'M13' && d.value !== '-' && d.value !== '.')
    .sort((a, b) => {
      const ya = parseInt(a.year), yb = parseInt(b.year);
      if (ya !== yb) return yb - ya;
      return b.period.localeCompare(a.period);
    });
  if (sorted.length < 2) return null;
  const curr = parseFloat(sorted[0].value);
  const prev = parseFloat(sorted[1].value);
  if (isNaN(curr) || isNaN(prev) || prev === 0) return null;
  return {
    current: curr,
    previous: prev,
    change: +(curr - prev).toFixed(4),
    changePct: +(((curr - prev) / prev) * 100).toFixed(4),
    currentPeriod: `${sorted[0].year}-${sorted[0].period}`,
    previousPeriod: `${sorted[1].year}-${sorted[1].period}`,
  };
}

// Briefing — pull latest CPI, unemployment, payrolls
export async function briefing(apiKey) {
  const seriesIds = Object.keys(SERIES);
  const resp = await getSeries(seriesIds, { apiKey });

  if (resp.error) {
    const fallback = await buildFredFallbackBriefing(resp.error);
    if (fallback) return fallback;
    return { source: 'BLS', error: resp.error, timestamp: new Date().toISOString() };
  }

  if (resp.status !== 'REQUEST_SUCCEEDED' || !resp.Results?.series?.length) {
    const fallbackReason = resp.message?.[0] || 'BLS API returned no data';
    const fallback = await buildFredFallbackBriefing(fallbackReason);
    if (fallback) return fallback;
    return {
      source: 'BLS',
      error: fallbackReason,
      rawStatus: resp.status,
      timestamp: new Date().toISOString(),
    };
  }

  const indicators = [];

  for (const s of resp.Results.series) {
    const id = s.seriesID;
    const label = SERIES[id] || id;
    const latest = latestFromSeries(s);
    const mom = momChange(s);

    if (!latest) {
      indicators.push({ id, label, value: null, date: null });
      continue;
    }

    const value = parseFloat(latest.value);
    const period = `${latest.year}-${latest.period}`;

    indicators.push({
      id,
      label,
      value,
      period,
      date: latest.year + '-' + latest.period.replace('M', '').padStart(2, '0'),
      momChange: mom ? mom.change : null,
      momChangePct: mom ? mom.changePct : null,
    });
  }

  return {
    source: 'BLS',
    timestamp: new Date().toISOString(),
    indicators,
    signals: buildSignalsFromIndicators(indicators),
  };
}

if (process.argv[1]?.endsWith('bls.mjs')) {
  const data = await briefing(process.env.BLS_API_KEY);
  console.log(JSON.stringify(data, null, 2));
}
