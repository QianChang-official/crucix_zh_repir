// Flightera Flight Data (RapidAPI)
// Optional aviation delay/performance layer. Disabled unless a RapidAPI key is provided.

const BASE = 'https://flightera-flight-data.p.rapidapi.com';
const HOST = 'flightera-flight-data.p.rapidapi.com';
const DEFAULT_AIRPORTS = ['ZBAA', 'ZSPD', 'ZGGG', 'VHHH', 'OMDB', 'TLV', 'IKA'];

function getConfiguredAirports() {
  const value = process.env.FLIGHTERA_AIRPORTS || '';
  const parsed = value
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter(Boolean);
  return parsed.length ? parsed.slice(0, 8) : DEFAULT_AIRPORTS;
}

async function fetchRapidJson(path, params, apiKey) {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Crucix/1.0',
        'Accept': 'application/json',
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': HOST,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function normalizeDelayStats(ident, payload) {
  const data = payload?.data || payload || {};
  const totals = data.summary || data.stats || data;
  return {
    ident,
    totalFlights: pickNumber(totals.totalFlights, totals.flights, totals.total, totals.movements) || 0,
    delayedFlights: pickNumber(totals.delayedFlights, totals.delays, totals.delayed, totals.totalDelayed) || 0,
    averageDelayMin: pickNumber(totals.averageDelayMin, totals.avgDelayMin, totals.avgDelay, totals.averageDelay),
    delayedPercent: pickNumber(totals.delayedPercent, totals.percentDelayed, totals.delayPercent),
    onTimePercent: pickNumber(totals.onTimePercent, totals.percentOnTime, totals.onTimeRate),
    raw: data,
  };
}

export async function briefing() {
  const apiKey = process.env.FLIGHTERA_RAPIDAPI_KEY || '';
  if (!apiKey) {
    return {
      source: 'Flightera',
      timestamp: new Date().toISOString(),
      configured: false,
      airports: getConfiguredAirports(),
      stats: [],
      signals: [],
      note: 'Set FLIGHTERA_RAPIDAPI_KEY to enable optional airport delay monitoring',
    };
  }

  const airports = getConfiguredAirports();
  const dt = new Date().toISOString().slice(0, 10);
  const results = await Promise.allSettled(
    airports.map(async ident => {
      const departures = await fetchRapidJson('/airport/delays_by_day', {
        ident,
        dt,
        isDeparture: true,
      }, apiKey);
      return normalizeDelayStats(ident, departures);
    })
  );

  const stats = results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value)
    .sort((left, right) => (right.delayedPercent || 0) - (left.delayedPercent || 0));

  const signals = stats
    .filter(stat => (stat.delayedPercent || 0) >= 35 || (stat.averageDelayMin || 0) >= 30)
    .slice(0, 4)
    .map(stat => `AIRPORT DELAY WATCH: ${stat.ident} delays ${stat.delayedPercent || '--'}% with avg ${stat.averageDelayMin || '--'} min`);

  return {
    source: 'Flightera',
    timestamp: new Date().toISOString(),
    configured: true,
    airports,
    stats,
    signals,
  };
}

if (process.argv[1]?.endsWith('flightera.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}