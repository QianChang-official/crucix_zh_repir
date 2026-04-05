// World Bank — Cross-country structural macro indicators
// No auth required. Complements the US-heavy FRED/BLS stack with major economy snapshots.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://api.worldbank.org/v2';
const COUNTRY_SET = 'USA;CHN;IND;DEU;JPN;GBR;RUS';

const INDICATORS = {
  'NY.GDP.MKTP.CD': { label: 'GDP (current US$)', key: 'gdp' },
  'FP.CPI.TOTL.ZG': { label: 'Inflation, consumer prices (annual %)', key: 'inflation' },
  'NE.TRD.GNFS.ZS': { label: 'Trade (% of GDP)', key: 'tradePct' },
  'MS.MIL.XPND.GD.ZS': { label: 'Military expenditure (% of GDP)', key: 'militaryPct' },
};

async function fetchIndicator(indicatorId) {
  const params = new URLSearchParams({ format: 'json', per_page: '200', mrv: '3' });
  return safeFetch(`${BASE}/country/${COUNTRY_SET}/indicator/${indicatorId}?${params}`, { timeout: 20000 });
}

function latestByCountry(rows) {
  const latest = {};
  for (const row of rows || []) {
    const code = row?.countryiso3code;
    if (!code || code.length !== 3) continue;
    if (latest[code]) continue;
    if (row.value == null) continue;
    latest[code] = row;
  }
  return latest;
}

export async function briefing() {
  const indicatorEntries = Object.entries(INDICATORS);
  const results = await Promise.all(indicatorEntries.map(([indicatorId]) => fetchIndicator(indicatorId)));

  if (results.every(result => result?.error)) {
    return {
      source: 'World Bank',
      timestamp: new Date().toISOString(),
      error: results.find(result => result?.error)?.error || 'Failed to fetch World Bank data',
    };
  }

  const profiles = {};
  indicatorEntries.forEach(([indicatorId, meta], index) => {
    const payload = results[index];
    const rows = Array.isArray(payload?.[1]) ? payload[1] : [];
    const latest = latestByCountry(rows);
    for (const [code, row] of Object.entries(latest)) {
      if (!profiles[code]) {
        profiles[code] = {
          code,
          name: row.country?.value || code,
          dates: {},
        };
      }
      profiles[code][meta.key] = row.value;
      profiles[code].dates[meta.key] = row.date;
    }
  });

  const profileList = Object.values(profiles).sort((a, b) => (b.gdp || 0) - (a.gdp || 0));
  const gdpLeaders = profileList.filter(p => p.gdp != null).slice(0, 5);
  const inflationLeaders = [...profileList]
    .filter(p => p.inflation != null)
    .sort((a, b) => (b.inflation || 0) - (a.inflation || 0))
    .slice(0, 5);
  const tradeExposure = [...profileList]
    .filter(p => p.tradePct != null)
    .sort((a, b) => (b.tradePct || 0) - (a.tradePct || 0))
    .slice(0, 5);
  const militaryBurden = [...profileList]
    .filter(p => p.militaryPct != null)
    .sort((a, b) => (b.militaryPct || 0) - (a.militaryPct || 0))
    .slice(0, 5);

  const signals = [];
  if ((inflationLeaders[0]?.inflation || 0) >= 6) {
    signals.push(`GLOBAL INFLATION OUTLIER: ${inflationLeaders[0].name} at ${inflationLeaders[0].inflation.toFixed(1)}%`);
  }
  if ((tradeExposure[0]?.tradePct || 0) >= 80) {
    signals.push(`TRADE DEPENDENCE: ${tradeExposure[0].name} trade flows equal ${tradeExposure[0].tradePct.toFixed(0)}% of GDP`);
  }
  if ((militaryBurden[0]?.militaryPct || 0) >= 3) {
    signals.push(`MILITARY BURDEN: ${militaryBurden[0].name} spends ${militaryBurden[0].militaryPct.toFixed(1)}% of GDP on defense`);
  }

  return {
    source: 'World Bank',
    timestamp: new Date().toISOString(),
    profiles: profileList,
    gdpLeaders,
    inflationLeaders,
    tradeExposure,
    militaryBurden,
    signals,
  };
}

if (process.argv[1]?.endsWith('worldbank.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}