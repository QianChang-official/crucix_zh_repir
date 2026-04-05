// NASA EONET — Earth Observatory Natural Event Tracker
// No auth required. Tracks open global natural hazard events.

import { safeFetch } from '../utils/fetch.mjs';

const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60';

function getLatestGeometry(event) {
  const geometry = event?.geometry || [];
  return geometry.length ? geometry[geometry.length - 1] : null;
}

function compactEvent(event) {
  const latest = getLatestGeometry(event);
  const [lon, lat] = latest?.coordinates || [];
  return {
    id: event?.id || null,
    title: event?.title || 'Unknown event',
    category: event?.categories?.[0]?.title || 'Other',
    categoryId: event?.categories?.[0]?.id || 'other',
    source: event?.sources?.[0]?.id || null,
    link: event?.link || null,
    date: latest?.date || null,
    lat: typeof lat === 'number' ? lat : null,
    lon: typeof lon === 'number' ? lon : null,
    magnitudeValue: typeof latest?.magnitudeValue === 'number' ? latest.magnitudeValue : null,
    magnitudeUnit: latest?.magnitudeUnit || null,
  };
}

export async function briefing() {
  const data = await safeFetch(EONET_URL, { timeout: 20000 });

  if (data.error) {
    return {
      source: 'NASA EONET',
      timestamp: new Date().toISOString(),
      error: data.error,
    };
  }

  const events = (data.events || [])
    .map(compactEvent)
    .filter(event => event.lat !== null && event.lon !== null)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const categories = {};
  for (const event of events) {
    categories[event.category] = (categories[event.category] || 0) + 1;
  }

  const signals = [];
  const severeStorms = categories['Severe Storms'] || 0;
  const wildfires = categories['Wildfires'] || 0;
  const volcanoes = categories['Volcanoes'] || 0;
  const floods = categories['Floods'] || 0;
  if (severeStorms >= 3) signals.push(`GLOBAL STORM LOAD: ${severeStorms} severe storm systems currently open`);
  if (wildfires >= 5) signals.push(`WILDFIRE PRESSURE: ${wildfires} open wildfire events tracked by NASA EONET`);
  if (volcanoes > 0) signals.push(`VOLCANIC WATCH: ${volcanoes} active volcanic events open globally`);
  if (floods > 0) signals.push(`FLOOD WATCH: ${floods} open flood events in the natural hazard stack`);

  return {
    source: 'NASA EONET',
    timestamp: new Date().toISOString(),
    openEvents: events.length,
    categories,
    events: events.slice(0, 20),
    signals,
  };
}

if (process.argv[1]?.endsWith('nasa-eonet.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}