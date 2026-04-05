// USGS Earthquake Hazards Program — Real-time global earthquake monitoring
// No auth required. Tracks the latest global seismic activity.

import { safeFetch, daysAgo } from '../utils/fetch.mjs';

const BASE = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

function buildQuery(params) {
  const qs = new URLSearchParams({ format: 'geojson', ...params });
  return `${BASE}?${qs}`;
}

function extractRegion(place = '') {
  if (place.includes(',')) return place.split(',').pop().trim();
  if (place.includes(' of ')) return place.split(' of ').pop().trim();
  return place.trim() || 'Unknown';
}

function compactQuake(feature) {
  const props = feature?.properties || {};
  const [lon, lat, depthKm] = feature?.geometry?.coordinates || [];
  return {
    id: feature?.id || null,
    magnitude: typeof props.mag === 'number' ? props.mag : null,
    place: props.place || 'Unknown',
    region: extractRegion(props.place),
    time: props.time ? new Date(props.time).toISOString() : null,
    updated: props.updated ? new Date(props.updated).toISOString() : null,
    lat: typeof lat === 'number' ? lat : null,
    lon: typeof lon === 'number' ? lon : null,
    depthKm: typeof depthKm === 'number' ? depthKm : null,
    tsunami: props.tsunami === 1,
    significance: props.sig || 0,
    feltReports: props.felt || 0,
    alert: props.alert || null,
    status: props.status || null,
    url: props.url || null,
  };
}

async function getRecentEarthquakes() {
  return safeFetch(buildQuery({
    starttime: daysAgo(1),
    minmagnitude: '2.5',
    orderby: 'time',
    limit: '100',
  }), { timeout: 20000 });
}

export async function briefing() {
  const data = await getRecentEarthquakes();

  if (data.error) {
    return {
      source: 'USGS Earthquakes',
      timestamp: new Date().toISOString(),
      error: data.error,
    };
  }

  const earthquakes = (data.features || []).map(compactQuake).filter(q => q.magnitude !== null);
  earthquakes.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  const significant = earthquakes.filter(q => q.magnitude >= 5);
  const major = earthquakes.filter(q => q.magnitude >= 6);
  const tsunamiCapable = earthquakes.filter(q => q.tsunami);
  const maxMagnitude = earthquakes.reduce((max, quake) => Math.max(max, quake.magnitude || 0), 0);

  const byRegion = {};
  for (const quake of earthquakes) {
    byRegion[quake.region] = (byRegion[quake.region] || 0) + 1;
  }

  const topRegions = Object.entries(byRegion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([region, count]) => ({ region, count }));

  const signals = [];
  if (maxMagnitude >= 6.5) {
    signals.push(`SEISMIC SPIKE: max magnitude ${maxMagnitude.toFixed(1)} in the last 24h`);
  }
  if (significant.length >= 5) {
    signals.push(`ELEVATED EARTHQUAKE TEMPO: ${significant.length} magnitude 5+ quakes in 24h`);
  }
  if (tsunamiCapable.length > 0) {
    signals.push(`TSUNAMI WATCHLIST: ${tsunamiCapable.length} recent earthquakes flagged for tsunami potential`);
  }
  if (major.length >= 2) {
    signals.push(`MULTI-REGION SEISMIC STRESS: ${major.length} magnitude 6+ events recorded globally`);
  }

  return {
    source: 'USGS Earthquakes',
    timestamp: new Date().toISOString(),
    summary: {
      total24h: earthquakes.length,
      significantCount: significant.length,
      majorCount: major.length,
      tsunamiCount: tsunamiCapable.length,
      maxMagnitude,
    },
    topRegions,
    earthquakes: earthquakes.slice(0, 20),
    signals,
  };
}

if (process.argv[1]?.endsWith('usgs-earthquakes.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}