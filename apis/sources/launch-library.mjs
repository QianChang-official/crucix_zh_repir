// Launch Library 2 — Upcoming launch schedule and mission metadata
// No auth required. Adds forward-looking launch cadence and pad geolocation.

import { safeFetch } from '../utils/fetch.mjs';

const LAUNCH_URL = 'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=10';

function compactLaunch(launch) {
  return {
    id: launch?.id || null,
    name: launch?.name || 'Unknown launch',
    net: launch?.net || null,
    status: launch?.status?.name || null,
    provider: launch?.launch_service_provider?.name || null,
    probability: launch?.probability ?? null,
    weatherConcerns: launch?.weather_concerns || null,
    missionType: launch?.mission?.type || null,
    missionName: launch?.mission?.name || null,
    orbit: launch?.mission?.orbit?.name || null,
    pad: launch?.pad?.name || null,
    lat: typeof launch?.pad?.latitude === 'number' ? launch.pad.latitude : null,
    lon: typeof launch?.pad?.longitude === 'number' ? launch.pad.longitude : null,
    country: launch?.pad?.country?.name || null,
    url: launch?.url || null,
  };
}

export async function briefing() {
  const data = await safeFetch(LAUNCH_URL, { timeout: 20000 });

  if (data.error) {
    return {
      source: 'Launch Library 2',
      timestamp: new Date().toISOString(),
      error: data.error,
    };
  }

  const now = Date.now();
  const launches = (data.results || [])
    .map(compactLaunch)
    .filter(launch => {
      const net = new Date(launch.net || 0).getTime();
      return Number.isFinite(net) && net >= now;
    })
    .sort((a, b) => new Date(a.net || 0) - new Date(b.net || 0));
  const next72h = launches.filter(launch => {
    const net = new Date(launch.net || 0).getTime();
    return Number.isFinite(net) && net >= now && net <= (now + 72 * 60 * 60 * 1000);
  }).length;

  const byProvider = {};
  for (const launch of launches) {
    const provider = launch.provider || 'Unknown';
    byProvider[provider] = (byProvider[provider] || 0) + 1;
  }

  const weatherRisk = launches.filter(launch => launch.weatherConcerns);
  const signals = [];
  if (next72h > 0) signals.push(`LAUNCH WINDOW: ${next72h} scheduled launches inside the next 72 hours`);
  if (weatherRisk.length > 0) signals.push(`WEATHER WATCH: ${weatherRisk.length} upcoming launches list weather constraints`);
  if (launches.length >= 6) signals.push(`FORWARD CADENCE: ${launches.length} launches currently on the upcoming schedule`);

  return {
    source: 'Launch Library 2',
    timestamp: new Date().toISOString(),
    upcomingCount: launches.length,
    next72h,
    byProvider,
    launches,
    signals,
  };
}

if (process.argv[1]?.endsWith('launch-library.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}