// OpenSky Network — Real-time flight tracking
// Free for research. 4,000 API credits/day (no auth), 8,000 with account.
// Tracks all aircraft with ADS-B transponders including many military.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://opensky-network.org/api';
const AIRPLANES_LIVE_BASE = 'https://api.airplanes.live/v2';
const AIRPLANES_LIVE_MIL_URL = `${AIRPLANES_LIVE_BASE}/mil`;
const AIRPLANES_LIVE_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Origin: 'https://airplanes.live',
  Pragma: 'no-cache',
  Referer: 'https://airplanes.live/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
};
const AIRPLANES_LIVE_CACHE_TTL_MS = 2 * 60 * 1000;
let airplanesLiveMilCache = { expiresAt: 0, data: null };

// Get all current flights (global state vector)
export async function getAllFlights() {
  return safeFetch(`${BASE}/states/all`, { timeout: 30000 });
}

// Get flights in a bounding box (lat/lon)
export async function getFlightsInArea(lamin, lomin, lamax, lomax) {
  const params = new URLSearchParams({
    lamin: String(lamin),
    lomin: String(lomin),
    lamax: String(lamax),
    lomax: String(lomax),
  });
  return safeFetch(`${BASE}/states/all?${params}`, { timeout: 20000 });
}

// Get flights by specific aircraft (ICAO24 hex codes)
export async function getFlightsByIcao(icao24List) {
  const icao = Array.isArray(icao24List) ? icao24List : [icao24List];
  const params = icao.map(i => `icao24=${i}`).join('&');
  return safeFetch(`${BASE}/states/all?${params}`, { timeout: 20000 });
}

// Get departures from an airport in a time range
export async function getDepartures(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return safeFetch(`${BASE}/flights/departure?${params}`);
}

// Get arrivals at an airport
export async function getArrivals(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return safeFetch(`${BASE}/flights/arrival?${params}`);
}

// Key hotspot regions for monitoring
const HOTSPOTS = {
  middleEast: { lamin: 12, lomin: 30, lamax: 42, lomax: 65, label: 'Middle East' },
  taiwan: { lamin: 20, lomin: 115, lamax: 28, lomax: 125, label: 'Taiwan Strait' },
  ukraine: { lamin: 44, lomin: 22, lamax: 53, lomax: 41, label: 'Ukraine Region' },
  baltics: { lamin: 53, lomin: 19, lamax: 60, lomax: 29, label: 'Baltic Region' },
  southChinaSea: { lamin: 5, lomin: 105, lamax: 23, lomax: 122, label: 'South China Sea' },
  koreanPeninsula: { lamin: 33, lomin: 124, lamax: 43, lomax: 132, label: 'Korean Peninsula' },
  caribbean: { lamin: 18, lomin: -90, lamax: 30, lomax: -72, label: 'Caribbean' },
  gulfOfGuinea: { lamin: -2, lomin: -5, lamax: 8, lomax: 10, label: 'Gulf of Guinea' },
  capeRoute: { lamin: -38, lomin: 12, lamax: -28, lomax: 24, label: 'Cape Route' },
  hornOfAfrica: { lamin: 5, lomin: 40, lamax: 15, lomax: 55, label: 'Horn of Africa' },
};

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function buildSampleFromState(state) {
  const hex = String(state?.[0] || '').trim().toLowerCase();
  const callsign = String(state?.[1] || '').trim();
  const country = String(state?.[2] || 'Unknown').trim() || 'Unknown';
  const altitudeMeters = Number(state?.[7]);
  if (!hex && !callsign) return null;
  return {
    hex: hex || null,
    callsign: callsign || null,
    country,
    altitudeM: Number.isFinite(altitudeMeters) ? Math.round(altitudeMeters) : null,
  };
}

function buildHotspotSummary(region, key, states, error = null, extra = {}) {
  const normalizedStates = Array.isArray(states) ? states : [];
  return {
    region,
    key,
    totalAircraft: normalizedStates.length,
    byCountry: normalizedStates.reduce((acc, state) => {
      const country = state?.[2] || 'Unknown';
      acc[country] = (acc[country] || 0) + 1;
      return acc;
    }, {}),
    noCallsign: normalizedStates.filter(state => !state?.[1]?.trim()).length,
    highAltitude: normalizedStates.filter(state => state?.[7] && state[7] > 12000).length,
    samples: normalizedStates
      .map(buildSampleFromState)
      .filter(Boolean)
      .sort((left, right) => (right.altitudeM || 0) - (left.altitudeM || 0))
      .slice(0, 4),
    ...extra,
    ...(error ? { error } : {}),
  };
}

function inBoundingBox(entry, box) {
  const lat = Number(entry?.lat);
  const lon = Number(entry?.lon);
  return Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= box.lamin
    && lat <= box.lamax
    && lon >= box.lomin
    && lon <= box.lomax;
}

function normalizeAirplanesLiveState(entry) {
  const altitudeFeet = Number(entry?.alt_baro ?? entry?.alt_geom);
  const altitudeMeters = Number.isFinite(altitudeFeet) ? altitudeFeet * 0.3048 : null;
  const callsign = String(entry?.flight || entry?.r || '').trim();
  const country = String(entry?.country || entry?.ownOpCountry || entry?.ownOp || 'Unknown').trim() || 'Unknown';
  return [
    String(entry?.hex || '').trim().toLowerCase(),
    callsign,
    country,
    null,
    null,
    isFiniteNumber(entry?.lon) ? Number(entry.lon) : null,
    isFiniteNumber(entry?.lat) ? Number(entry.lat) : null,
    altitudeMeters,
  ];
}

async function getMilitaryFlightsFromAirplanesLive() {
  if (airplanesLiveMilCache.expiresAt > Date.now() && airplanesLiveMilCache.data) {
    return airplanesLiveMilCache.data;
  }

  const data = await safeFetch(AIRPLANES_LIVE_MIL_URL, {
    timeout: 20000,
    retries: 0,
    headers: AIRPLANES_LIVE_HEADERS,
  });

  const normalized = data?.error
    ? { error: data.error }
    : {
        aircraft: Array.isArray(data?.ac) ? data.ac : [],
        total: Array.isArray(data?.ac) ? data.ac.length : 0,
      };

  airplanesLiveMilCache = {
    expiresAt: Date.now() + AIRPLANES_LIVE_CACHE_TTL_MS,
    data: normalized,
  };
  return normalized;
}

// Briefing — check hotspot regions for flight activity
export async function briefing() {
  const hotspotEntries = Object.entries(HOTSPOTS);
  const primaryResults = await Promise.all(
    hotspotEntries.map(async ([key, box]) => {
      const data = await getFlightsInArea(box.lamin, box.lomin, box.lamax, box.lomax);
      const states = Array.isArray(data?.states) ? data.states : [];
      return buildHotspotSummary(box.label, key, states, data?.error || null, { source: 'OpenSky' });
    })
  );

  const needsFallback = primaryResults.some(result => result.error);
  const militaryFallback = needsFallback ? await getMilitaryFlightsFromAirplanesLive() : null;
  const results = [];
  const fallbackRegions = [];

  for (const result of primaryResults) {
    if (!result.error) {
      results.push(result);
      continue;
    }

    if (militaryFallback && !militaryFallback.error) {
      const box = HOTSPOTS[result.key];
      const states = militaryFallback.aircraft
        .filter(entry => inBoundingBox(entry, box))
        .map(normalizeAirplanesLiveState);
      fallbackRegions.push(result.region);
      results.push(buildHotspotSummary(box.label, result.key, states, null, {
        source: 'Airplanes.live MIL',
        fallbackSource: 'Airplanes.live MIL',
        rawCount: militaryFallback.total,
      }));
      continue;
    }

    results.push({
      ...result,
      error: `OpenSky: ${result.error}; Airplanes.live MIL: ${militaryFallback?.error || 'unavailable'}`,
      fallbackSource: 'Airplanes.live MIL',
    });
  }

  const hotspotErrors = results
    .filter(result => result.error)
    .map(result => ({ region: result.region, error: result.error }));

  return {
    source: fallbackRegions.length ? 'OpenSky / Airplanes.live MIL' : 'OpenSky',
    timestamp: new Date().toISOString(),
    hotspots: results,
    ...(fallbackRegions.length ? { fallbackRegions, fallbackMode: 'mil-global' } : {}),
    ...(hotspotErrors.length ? {
      error: hotspotErrors.length === results.length
        ? `Air hotspots unavailable across all regions: ${hotspotErrors[0].error}`
        : `Air hotspots unavailable for ${hotspotErrors.length}/${results.length} regions`,
      hotspotErrors,
    } : {}),
  };
}

if (process.argv[1]?.endsWith('opensky.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
