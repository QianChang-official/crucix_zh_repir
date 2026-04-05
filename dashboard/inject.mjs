#!/usr/bin/env node
// Crucix Dashboard Data Synthesizer
// Reads runs/latest.json, fetches RSS news, generates signal-based ideas,
// and injects everything into dashboard/public/jarvis.html
//
// Exports synthesize(), generateIdeas(), fetchAllNews() for use by server.mjs

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import config from '../crucix.config.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { generateLLMIdeas } from '../lib/llm/ideas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// === Helpers ===
const EVENT_STOPWORDS = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'have', 'has', 'into', 'after',
  'over', 'under', 'about', 'against', 'their', 'they', 'been', 'were', 'says',
  'said', 'will', 'would', 'could', 'should', 'just', 'latest', 'update', 'news'
]);

// === Geo-tagging keyword map ===
const geoKeywords = {
  'Ukraine':[49,32],'Russia':[56,38],'Moscow':[55.7,37.6],'Kyiv':[50.4,30.5],
  'China':[35,105],'Beijing':[39.9,116.4],'Iran':[32,53],'Tehran':[35.7,51.4],
  'Israel':[31.5,35],'Gaza':[31.4,34.4],'Palestine':[31.9,35.2],
  'Syria':[35,38],'Iraq':[33,44],'Saudi':[24,45],'Yemen':[15,48],'Lebanon':[34,36],
  'India':[20,78],'Japan':[36,138],'Korea':[37,127],'Pyongyang':[39,125.7],
  'Taiwan':[23.5,121],'Philippines':[13,122],'Myanmar':[20,96],
  'Canada':[56,-96],'Mexico':[23,-102],'Brazil':[-14,-51],'Argentina':[-38,-63],
  'Colombia':[4,-74],'Venezuela':[7,-66],'Cuba':[22,-80],'Chile':[-35,-71],
  'Germany':[51,10],'France':[46,2],'UK':[54,-2],'Britain':[54,-2],'London':[51.5,-0.1],
  'Spain':[40,-4],'Italy':[42,12],'Poland':[52,20],'NATO':[50,4],'EU':[50,4],
  'Turkey':[39,35],'Greece':[39,22],'Romania':[46,25],'Finland':[64,26],'Sweden':[62,15],
  'Africa':[0,20],'Nigeria':[10,8],'South Africa':[-30,25],'Kenya':[-1,38],
  'Egypt':[27,30],'Libya':[27,17],'Sudan':[13,30],'Ethiopia':[9,38],
  'Somalia':[5,46],'Congo':[-4,22],'Uganda':[1,32],'Morocco':[32,-6],
  'Pakistan':[30,70],'Afghanistan':[33,65],'Bangladesh':[24,90],
  'Australia':[-25,134],'Indonesia':[-2,118],'Thailand':[15,100],
  'US':[39,-98],'America':[39,-98],'Washington':[38.9,-77],'Pentagon':[38.9,-77],
  'Trump':[38.9,-77],'White House':[38.9,-77],
  'Wall Street':[40.7,-74],'New York':[40.7,-74],'California':[37,-120],
  'Nepal':[28,84],'Cambodia':[12.5,105],'Malawi':[-13.5,34],'Burundi':[-3.4,29.9],
  'Oman':[21,57],'Netherlands':[52.1,5.3],'Gabon':[-0.8,11.6],
  'Peru':[-10,-76],'Ecuador':[-2,-78],'Bolivia':[-17,-65],
  'Singapore':[1.35,103.8],'Malaysia':[4.2,101.9],'Vietnam':[16,108],
  'Algeria':[28,3],'Tunisia':[34,9],'Zimbabwe':[-20,30],'Mozambique':[-18,35],
  // Americas expansion
  'Texas':[31,-100],'Florida':[28,-82],'Chicago':[41.9,-87.6],'Los Angeles':[34,-118],
  'San Francisco':[37.8,-122.4],'Seattle':[47.6,-122.3],'Miami':[25.8,-80.2],
  'Toronto':[43.7,-79.4],'Ottawa':[45.4,-75.7],'Vancouver':[49.3,-123.1],
  'São Paulo':[-23.5,-46.6],'Rio':[-22.9,-43.2],'Buenos Aires':[-34.6,-58.4],
  'Bogotá':[4.7,-74.1],'Lima':[-12,-77],'Santiago':[-33.4,-70.7],
  'Caracas':[10.5,-66.9],'Havana':[23.1,-82.4],'Panama':[9,-79.5],
  'Guatemala':[14.6,-90.5],'Honduras':[14.1,-87.2],'El Salvador':[13.7,-89.2],
  'Costa Rica':[10,-84],'Jamaica':[18.1,-77.3],'Haiti':[19,-72],
  'Dominican':[18.5,-70],'Puerto Rico':[18.2,-66.5],
  // More Asia-Pacific
  'Sri Lanka':[7,80],'Hong Kong':[22.3,114.2],'Taipei':[25,121.5],
  'Seoul':[37.6,127],'Osaka':[34.7,135.5],'Mumbai':[19.1,72.9],
  'Delhi':[28.6,77.2],'Shanghai':[31.2,121.5],'Shenzhen':[22.5,114.1],
  'Auckland':[-36.8,174.8],'Papua New Guinea':[-6.3,147],
  // More Europe
  'Berlin':[52.5,13.4],'Paris':[48.9,2.3],'Madrid':[40.4,-3.7],
  'Rome':[41.9,12.5],'Warsaw':[52.2,21],'Prague':[50.1,14.4],
  'Vienna':[48.2,16.4],'Budapest':[47.5,19.1],'Bucharest':[44.4,26.1],
  'Kyiv':[50.4,30.5],'Oslo':[59.9,10.7],'Copenhagen':[55.7,12.6],
  'Brussels':[50.8,4.4],'Zurich':[47.4,8.5],'Dublin':[53.3,-6.3],
  'Lisbon':[38.7,-9.1],'Athens':[37.9,23.7],'Minsk':[53.9,27.6],
  // More Africa
  'Nairobi':[-1.3,36.8],'Lagos':[6.5,3.4],'Accra':[5.6,-0.2],
  'Addis Ababa':[9,38.7],'Cape Town':[-33.9,18.4],'Johannesburg':[-26.2,28],
  'Kinshasa':[-4.3,15.3],'Khartoum':[15.6,32.5],'Mogadishu':[2.1,45.3],
  'Dakar':[14.7,-17.5],'Abuja':[9.1,7.5],
  // Tech/Economy keywords with US locations
  'Fed':[38.9,-77],'Congress':[38.9,-77],'Senate':[38.9,-77],
  'Silicon Valley':[37.4,-122],'NASA':[28.6,-80.6],'Pentagon':[38.9,-77],
  'IMF':[38.9,-77],'World Bank':[38.9,-77],'UN':[40.7,-74],
  '伊朗':[32,53],'美国':[39,-98],'乌克兰':[49,32],'俄罗斯':[56,38],'以色列':[31.5,35],
  '中国':[35,105],'北京':[39.9,116.4],'日本':[36,138],'韩国':[37,127],'科威特':[29.3,47.5],
  '阿联酋':[24,54],'沙特':[24,45],'香港':[22.3,114.2],'新疆':[43.8,87.6],'吐鲁番':[42.95,89.19],
  '欧盟':[50,4],'德国':[51,10],'葡萄牙':[39.5,-8],'霍尔木兹':[26.5,56.5],'阿克苏':[41.17,80.26],
};

function geoTagText(text) {
  if (!text) return null;
  for (const [keyword, [lat, lon]] of Object.entries(geoKeywords)) {
    if (text.includes(keyword)) {
      return { lat, lon, region: keyword };
    }
  }
  return null;
}

function sanitizeExternalUrl(raw) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function getTimeValue(value) {
  if (value == null || value === '') return 0;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) < 1e11 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    if (/^-?\d{10,16}$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return trimmed.length <= 10 ? numeric * 1000 : numeric;
      }
    }
    const parsed = new Date(trimmed).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortByNewest(list, selector) {
  return [...(list || [])].sort((left, right) => getTimeValue(selector(right)) - getTimeValue(selector(left)));
}

function sortByOldest(list, selector) {
  return [...(list || [])].sort((left, right) => getTimeValue(selector(left)) - getTimeValue(selector(right)));
}

function sanitizeTelegramText(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/t\.me\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRenderableTelegramPost(text) {
  const cleaned = sanitizeTelegramText(text).replace(/[\u{1F300}-\u{1FAFF}\u{1F1E0}-\u{1F1FF}]/gu, ' ').trim();
  if (!cleaned) return false;
  if (cleaned.length >= 24) return true;
  return /[\p{L}\p{N}]{6,}/u.test(cleaned);
}

function buildEventKey(text) {
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/t\.me\/\S+/gi, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{1F1E0}-\u{1F1FF}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const tokens = cleaned
    .split(' ')
    .filter(token => token.length > 2 && !EVENT_STOPWORDS.has(token));

  if (tokens.length >= 5) return tokens.slice(0, 12).join(' ');
  return cleaned.slice(0, 96);
}

function dedupeTelegramPosts(posts = []) {
  const merged = new Map();

  for (const post of posts) {
    const text = sanitizeTelegramText(post.text);
    if (!isRenderableTelegramPost(text)) continue;

    const key = buildEventKey(text) || `${post.channel || 'tg'}|${text.slice(0, 96)}`;
    const existing = merged.get(key);
    const candidateTime = getTimeValue(post.date);

    if (!existing) {
      merged.set(key, {
        channel: post.channel || '',
        text: text.substring(0, 220),
        views: post.views || 0,
        date: post.date || null,
        urgentFlags: [...new Set(post.urgentFlags || [])],
      });
      continue;
    }

    const existingTime = getTimeValue(existing.date);
    if (!existingTime || (candidateTime && candidateTime < existingTime)) {
      existing.date = post.date || existing.date;
      existing.channel = post.channel || existing.channel;
    }
    if (text.length > (existing.text || '').length) {
      existing.text = text.substring(0, 220);
    }
    existing.views = Math.max(existing.views || 0, post.views || 0);
    existing.urgentFlags = [...new Set([...(existing.urgentFlags || []), ...(post.urgentFlags || [])])];
  }

  return sortByNewest([...merged.values()], item => item.date);
}

function mergeFeedItemsByEvent(feed = []) {
  const clusters = [];

  const shouldCompareFeedItems = (item, cluster) => {
    if (!item?.headline || !cluster?.headline) return false;
    if ((item.type === 'telegram') !== (cluster.type === 'telegram')) return false;
    if ((item.type === 'space') !== (cluster.type === 'space')) return false;
    if ((item.type === 'telegram' || item.type === 'space') && item.type !== cluster.type) return false;

    const itemTime = getTimeValue(item.timestamp);
    const clusterTime = getTimeValue(cluster.latestTimestamp || cluster.timestamp);
    if (itemTime && clusterTime && Math.abs(itemTime - clusterTime) > 18 * 60 * 60 * 1000) return false;

    return true;
  };

  const similarityThreshold = (item, cluster) => {
    if (item.type === 'telegram') return 0.62;
    if (item.source === cluster.source) return 0.74;
    return 0.42;
  };

  for (const item of sortByOldest(feed, entry => entry.timestamp)) {
    const eventKey = buildEventKey(item.headline) || `${item.type || 'item'}|${String(item.headline || '').slice(0, 96)}`;
    const signature = buildHeadlineSignature(item.headline);
    const itemTime = getTimeValue(item.timestamp);

    let bestCluster = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      if (!shouldCompareFeedItems(item, cluster)) continue;
      const score = cluster.eventKey === eventKey ? 1 : headlineSimilarity(signature, cluster.signature);
      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    if (!bestCluster || bestScore < similarityThreshold(item, bestCluster)) {
      clusters.push({
        ...item,
        eventKey,
        signature,
        timestamp: item.timestamp,
        latestTimestamp: item.timestamp,
        latestSource: item.source,
        sources: [item.source].filter(Boolean),
        sourceCount: item.source ? 1 : 0,
        followUpCount: 0,
      });
      continue;
    }

    const existingTime = getTimeValue(bestCluster.timestamp);
    const latestTime = getTimeValue(bestCluster.latestTimestamp);
    if (!existingTime || (itemTime && itemTime < existingTime)) {
      bestCluster.timestamp = item.timestamp || bestCluster.timestamp;
      bestCluster.source = item.source || bestCluster.source;
      if (item.url) bestCluster.url = item.url;
      if (item.headline) bestCluster.headline = item.headline;
      if (item.region) bestCluster.region = item.region;
    }
    if (!latestTime || itemTime > latestTime) {
      bestCluster.latestTimestamp = item.timestamp || bestCluster.latestTimestamp;
      bestCluster.latestSource = item.source || bestCluster.latestSource;
    }
    if ((item.headline || '').length > (bestCluster.headline || '').length && itemTime <= getTimeValue(bestCluster.latestTimestamp)) {
      bestCluster.headline = item.headline;
    }
    if (item.url && !bestCluster.url) bestCluster.url = item.url;
    bestCluster.urgent = bestCluster.urgent || item.urgent;
    bestCluster.sources = [...new Set([...(bestCluster.sources || []), item.source].filter(Boolean))];
    bestCluster.sourceCount = bestCluster.sources.length;
    bestCluster.followUpCount += 1;
  }

  return sortByNewest(
    clusters.map(cluster => ({
      ...cluster,
      sourceCount: cluster.sourceCount || (cluster.sources || []).length,
      followUpCount: Math.max(0, cluster.followUpCount || 0),
    })),
    cluster => cluster.timestamp
  );
}

function buildCrossSourceSignals(data, { tgUrgent = [], whoItems = [], markets = {} } = {}) {
  const osintSignals = [];
  if (tgUrgent.length > 0) {
    osintSignals.push(`OSINT SURGE: ${tgUrgent.length} urgent Telegram posts detected in the latest sweep`);
    for (const post of tgUrgent.slice(0, 2)) {
      const text = sanitizeTelegramText(post.text);
      if (text) osintSignals.push(`OSINT FLASH: ${text.substring(0, 120)}`);
    }
  }

  for (const item of whoItems.slice(0, 2)) {
    if (item?.title) osintSignals.push(`WHO WATCH: ${item.title}`);
  }

  const marketSignals = [];
  for (const quote of [...(markets.asia || []), ...(markets.china || [])]) {
    if (quote?.changePct == null) continue;
    const change = Number(quote.changePct);
    const threshold = quote.symbol?.startsWith('^') || /\.SS$|\.SZ$/.test(quote.symbol || '') ? 1.2 : 2;
    if (Math.abs(change) < threshold) continue;
    marketSignals.push(`MARKET MOVE: ${quote.name || quote.symbol} ${change >= 0 ? '+' : ''}${change}%`);
  }

  const cyberSignals = [
    ...(data.sources['CISA-KEV']?.signals || []),
    ...(data.sources.NVD?.signals || []),
    ...(data.sources['Cloudflare-Radar']?.signals || []),
  ];
  const disasterSignals = [
    ...(data.sources.FIRMS?.signals || []),
    ...(data.sources['USGS-Earthquakes']?.signals || []),
    ...(data.sources['NASA-EONET']?.signals || []),
    ...(data.sources.Safecast?.signals || []),
  ];
  const macroSignals = [
    ...(data.sources.WorldBank?.signals || []),
    ...(data.sources.EIA?.signals || []),
    ...(data.sources.FRED?.signals || []),
    ...(data.sources.BLS?.signals || []),
    ...(data.sources.Treasury?.signals || []),
    ...(data.sources.Comtrade?.signals || []),
    ...(data.sources['Hot-News']?.signals || []),
    ...(data.sources['CN-Finance-RSS']?.signals || []),
    ...(data.sources.YFinance?.signals || []),
  ];
  const spaceSignals = [
    ...(data.sources.Space?.signals || []),
    ...(data.sources['Launch-Library']?.signals || []),
    ...(data.sources['Spaceflight-News']?.signals || []),
  ];
  const infrastructureSignals = [
    ...(data.sources.KiwiSDR?.signals || []),
    ...(data.sources['ADS-B']?.signals || []),
    ...(data.sources.EPA?.signals || []),
    ...(data.sources.Flightera?.signals || []),
  ];

  return normalizeSignalList([
    ...osintSignals,
    ...marketSignals,
    ...cyberSignals,
    ...disasterSignals,
    ...macroSignals,
    ...spaceSignals,
    ...infrastructureSignals,
  ]).slice(0, 18);
}

function normalizeSignalList(list = []) {
  const seen = new Set();
  const normalized = [];
  for (const entry of list) {
    const text = typeof entry === 'string'
      ? entry
      : typeof entry?.signal === 'string'
        ? entry.signal
        : typeof entry?.label === 'string'
          ? entry.label
          : typeof entry?.reason === 'string'
            ? entry.reason
            : null;
    if (!text) continue;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
  }
  return normalized;
}

async function fetchJsonWithTimeout(url, timeout = 8000, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Crucix/1.0',
        'Accept': 'application/json,text/plain,*/*',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function sumAirHotspots(hotspots = []) {
  return hotspots.reduce((sum, hotspot) => sum + (hotspot.totalAircraft || 0), 0);
}

function summarizeAirHotspots(hotspots = []) {
  return hotspots.map(h => ({
    region: h.region,
    total: h.totalAircraft || 0,
    noCallsign: h.noCallsign || 0,
    highAlt: h.highAltitude || 0,
    top: Object.entries(h.byCountry || {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
    samples: (h.samples || []).slice(0, 4).map(sample => ({
      callsign: sample.callsign || null,
      hex: sample.hex || null,
      country: sample.country || 'Unknown',
      altitudeM: sample.altitudeM ?? null,
    })),
  }));
}

function loadOpenSkyFallback(currentTimestamp) {
  const runsDir = join(ROOT, 'runs');
  if (!existsSync(runsDir)) return null;

  const currentMs = currentTimestamp ? new Date(currentTimestamp).getTime() : NaN;
  const files = readdirSync(runsDir)
    .filter(name => /^briefing_.*\.json$/.test(name))
    .sort()
    .reverse();

  for (const file of files) {
    const filePath = join(runsDir, file);
    try {
      const prior = JSON.parse(readFileSync(filePath, 'utf8'));
      const priorTimestamp = prior.sources?.OpenSky?.timestamp || prior.crucix?.timestamp || null;
      if (priorTimestamp && Number.isFinite(currentMs) && new Date(priorTimestamp).getTime() >= currentMs) continue;

      const hotspots = prior.sources?.OpenSky?.hotspots || [];
      if (sumAirHotspots(hotspots) > 0) {
        return { file, timestamp: priorTimestamp, hotspots };
      }
    } catch {
      // Ignore unreadable historical runs and continue searching backward.
    }
  }

  return null;
}

// === RSS Fetching ===
async function fetchRSS(url, source) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || '').trim();
      const link = sanitizeExternalUrl((block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/)?.[1] || '').trim());
      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      if (title && title !== source) items.push({ title, date: pubDate, source, url: link || undefined });
    }
    return items;
  } catch (e) {
    console.log(`RSS fetch failed (${source}):`, e.message);
    return [];
  }
}

const CHINA_NEWS_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

const CHINA_NEWS_SOURCE_FALLBACKS = {
  'China News': { lat: 39.9042, lon: 116.4074, region: 'China' },
  'People CN': { lat: 39.9042, lon: 116.4074, region: 'Beijing' },
  'Xinhua': { lat: 39.9042, lon: 116.4074, region: 'Beijing' },
  'CCTV China': { lat: 39.9042, lon: 116.4074, region: 'Beijing' },
  'Sina China': { lat: 31.2304, lon: 121.4737, region: 'Shanghai' },
  'CLS Telegraph': { lat: 31.2304, lon: 121.4737, region: 'Shanghai' },
  'CLS Hot': { lat: 31.2304, lon: 121.4737, region: 'Shanghai' },
  'Sina Finance Hot': { lat: 31.2304, lon: 121.4737, region: 'Shanghai' },
  'Eastmoney Hot': { lat: 31.2304, lon: 121.4737, region: 'China' },
  'Xueqiu Hot': { lat: 22.5431, lon: 114.0579, region: 'Shenzhen' },
};

const CHINA_NEWS_DEFAULT_MAX_AGE_HOURS = 168;

const CHINA_NEWS_SOURCES = [
  { type: 'rss', url: 'https://www.chinanews.com.cn/rss/china.xml', source: 'China News', limit: 18, kind: 'wire', maxAgeHours: 72 },
  {
    type: 'html',
    url: 'https://www.people.com.cn/GB/59476/index.html',
    source: 'People CN',
    limit: 18,
    kind: 'wire',
    maxAgeHours: 72,
    urlPattern: /https?:\/\/(?:politics|world|society|military|opinion)\.people\.com\.cn\/n1\/20\d{2}\/\d{4}\/c\d+-\d+\.html(?:\?.*)?$/i,
  },
  { type: 'json', url: 'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&num=18&page=1', source: 'Sina China', limit: 18, kind: 'portal', maxAgeHours: 72 },
  {
    type: 'html',
    url: 'https://www.news.cn/politics/',
    source: 'Xinhua',
    limit: 18,
    kind: 'state',
    maxAgeHours: 120,
    urlPattern: /https?:\/\/www\.news\.cn\/(?:politics|local|fortune|comments|legal|world)\/\d{8}\/[a-z0-9]+\/c\.html(?:\?.*)?$/i,
  },
  {
    type: 'html',
    url: 'https://news.cctv.com/china/',
    source: 'CCTV China',
    limit: 18,
    kind: 'state',
    maxAgeHours: 96,
    urlPattern: /https?:\/\/news\.cctv\.com\/\d{4}\/\d{2}\/\d{2}\/[A-Z0-9]+\.shtml(?:\?.*)?$/i,
  },
];

const CHINA_NEWS_POSITIVE_HINTS = [
  '上涨', '增', '增长', '扩大', '启动', '开通', '恢复', '落地', '通过', '突破', '创', '提振',
  'rise', 'surge', 'boost', 'resume', 'open', 'approve', 'launch', 'expand', 'stronger'
];
const CHINA_NEWS_NEGATIVE_HINTS = [
  '下跌', '降', '下降', '减少', '收紧', '暂停', '中断', '取消', '关闭', '受阻', '袭击', '爆炸', '封锁',
  'fall', 'drop', 'cut', 'halt', 'pause', 'close', 'attack', 'blast', 'blockade', 'weaker'
];
const CHINA_NEWS_DENY_HINTS = ['辟谣', '否认', '不实', '并未', '未发生', '假消息', 'deny', 'denies', 'false', 'refute', 'debunk'];
const CHINA_NEWS_CONFIRM_HINTS = ['确认', '证实', '通报', 'confirmed', 'confirm', 'verified', 'official'];

async function fetchTextWithTimeout(url, timeout = 10000, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Crucix/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(text = '') {
  return String(text)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#(\d+);/g, (_, value) => String.fromCharCode(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCharCode(parseInt(value, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(text = '') {
  return decodeHtmlEntities(
    String(text)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function makeAbsoluteHttpUrl(raw, baseUrl) {
  if (!raw) return undefined;
  const direct = sanitizeExternalUrl(raw);
  if (direct) return direct;
  try {
    return sanitizeExternalUrl(new URL(raw, baseUrl).toString());
  } catch {
    return undefined;
  }
}

function inferPublishedAt(value, url, fetchedAt = new Date().toISOString()) {
  const direct = getTimeValue(value);
  if (direct) return new Date(direct).toISOString();

  let match = String(url || '').match(/\/(20\d{2})-(\d{2})-(\d{2})\//);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0)).toISOString();
  }

  match = String(url || '').match(/\/(20\d{2})\/(\d{2})(\d{2})\//);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0)).toISOString();
  }

  match = String(url || '').match(/\/(20\d{2})(\d{2})(\d{2})\//);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0)).toISOString();
  }

  match = String(url || '').match(/(\d{2})(\d{2})(\d{2})\.shtml(?:$|\?)/i);
  if (match) {
    const year = Number(`20${match[1]}`);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year >= 2020 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString();
    }
  }

  return new Date(getTimeValue(fetchedAt) || Date.now()).toISOString();
}

function isPlausibleNewsTitle(title) {
  const text = stripHtml(title);
  if (!text || text.length < 8 || text.length > 120) return false;
  if (/^(首页|更多|专题|国内|国际|评论|视频|图片|直播|客户端|新华网|央视网|人民网|中国新闻网)$/u.test(text)) return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  return true;
}

function parseChinaNewsSeries(rawTitle) {
  const original = stripHtml(rawTitle || '').trim();
  if (!original) return { cleanTitle: '', series: null };

  let remainder = original;
  const tags = [];
  while (true) {
    const match = remainder.match(/^(?:\[([^\]]{1,24})\]|【([^】]{1,24})】)\s*/u);
    if (!match) break;
    const tag = String(match[1] || match[2] || '').trim();
    if (tag) tags.push(tag);
    remainder = remainder.slice(match[0].length).trim();
  }

  return {
    cleanTitle: remainder || original,
    series: tags.length ? tags[0] : null,
  };
}

function inferChinaNewsSource(source, url, series) {
  const current = String(source || '').trim() || 'China News';
  const safeUrl = String(url || '').trim().toLowerCase();
  if (current === 'CLS Hot' && (safeUrl.includes('cls.cn/telegraph') || series)) return 'CLS Telegraph';
  return current;
}

function normalizeChinaNewsItem(raw, options = {}) {
  const parsedTitle = parseChinaNewsSeries(raw?.title || raw?.headline || '');
  const title = parsedTitle.cleanTitle;
  if (!isPlausibleNewsTitle(title)) return null;

  const baseUrl = options.baseUrl || raw?.url || '';
  const url = makeAbsoluteHttpUrl(raw?.url || raw?.link || raw?.mobileUrl, baseUrl) || null;
  const source = inferChinaNewsSource(options.source || raw?.source || 'China News', url, parsedTitle.series);
  const summary = stripHtml(raw?.summary || raw?.content || raw?.description || raw?.intro || '');
  const fallback = CHINA_NEWS_SOURCE_FALLBACKS[source] || CHINA_NEWS_SOURCE_FALLBACKS['China News'];
  const geo = geoTagText(`${title} ${summary}`) || fallback;

  return {
    source,
    title,
    summary: summary.slice(0, 180),
    series: parsedTitle.series,
    url,
    kind: options.kind || raw?.kind || 'news',
    publishedAt: inferPublishedAt(raw?.publishedAt || raw?.date || raw?.time || raw?.ctime || raw?.mtime, url, options.fetchedAt),
    lat: geo?.lat,
    lon: geo?.lon,
    region: geo?.region || 'China',
  };
}

function isFreshEnough(timestamp, maxAgeHours = CHINA_NEWS_DEFAULT_MAX_AGE_HOURS) {
  const value = getTimeValue(timestamp);
  if (!value) return false;
  const now = Date.now();
  if (value > now + 15 * 60 * 1000) return false;
  return (now - value) <= maxAgeHours * 60 * 60 * 1000;
}

function parseHtmlAnchorFeed(html, definition, fetchedAt) {
  const items = [];
  const seen = new Set();
  const anchorRegex = /<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(html)) !== null) {
    const url = makeAbsoluteHttpUrl(match[2], definition.url);
    if (!url || !definition.urlPattern.test(url)) continue;
    const title = stripHtml(match[3]);
    if (!isPlausibleNewsTitle(title)) continue;

    const key = `${url}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const item = normalizeChinaNewsItem({ title, url }, {
      source: definition.source,
      baseUrl: definition.url,
      kind: definition.kind,
      fetchedAt,
    });
    if (!item) continue;

    items.push(item);
    if (items.length >= definition.limit) break;
  }

  return items;
}

async function fetchChinaNewsSource(definition) {
  if (definition.type === 'rss') {
    const items = await fetchRSS(definition.url, definition.source);
    return sortByNewest(
      items
        .map(item => normalizeChinaNewsItem(item, {
          source: definition.source,
          baseUrl: definition.url,
          kind: definition.kind,
          fetchedAt: new Date().toISOString(),
        }))
        .filter(item => item && isFreshEnough(item.publishedAt, definition.maxAgeHours)),
      item => item.publishedAt
    ).slice(0, definition.limit);
  }

  if (definition.type === 'json') {
    const payload = await fetchJsonWithTimeout(definition.url, 10000, CHINA_NEWS_BROWSER_HEADERS);
    const items = Array.isArray(payload?.result?.data)
      ? payload.result.data.map(entry => normalizeChinaNewsItem({
          title: entry.title,
          summary: entry.intro || entry.summary,
          url: entry.url || entry.wapurl,
          publishedAt: entry.ctime || entry.mtime,
        }, {
          source: definition.source,
          baseUrl: definition.url,
          kind: definition.kind,
          fetchedAt: payload?.result?.timestamp || new Date().toISOString(),
        }))
      : [];
    return sortByNewest(items.filter(item => item && isFreshEnough(item.publishedAt, definition.maxAgeHours)), item => item.publishedAt).slice(0, definition.limit);
  }

  const fetchedAt = new Date().toISOString();
  const html = await fetchTextWithTimeout(definition.url, 12000, CHINA_NEWS_BROWSER_HEADERS);
  return parseHtmlAnchorFeed(html, definition, fetchedAt).filter(item => isFreshEnough(item.publishedAt, definition.maxAgeHours));
}

function normalizeHotNewsItems(payload = {}) {
  return sortByNewest(
    (payload.items || [])
      .map(item => normalizeChinaNewsItem({
        title: item.title,
        summary: item.content,
        url: item.url,
        publishedAt: item.publishedAt,
      }, {
        source: item.source || 'CLS Hot',
        baseUrl: item.url || 'https://orz.ai/',
        kind: 'finance-wire',
        fetchedAt: payload.timestamp,
      }))
      .filter(Boolean),
    item => item.publishedAt
  );
}

function normalizeCnFinanceRssItems(payload = {}) {
  return sortByNewest(
    (payload.items || [])
      .map(item => normalizeChinaNewsItem({
        title: item.title,
        summary: item.content,
        url: item.url,
        publishedAt: item.publishedAt,
      }, {
        source: item.sourceZh || item.source || 'CN-Finance-RSS',
        baseUrl: item.url || 'https://localhost:8053/',
        kind: 'finance-wire',
        fetchedAt: payload.timestamp,
      }))
      .filter(Boolean),
    item => item.publishedAt
  );
}

function normalizeClsTelegraphDirectItems(payload = {}) {
  return sortByNewest(
    (payload.items || [])
      .map(item => normalizeChinaNewsItem({
        title: item.title,
        summary: item.content,
        url: item.url,
        publishedAt: item.publishedAt,
      }, {
        source: 'CLS Telegraph',
        baseUrl: item.url || 'https://www.cls.cn/telegraph',
        kind: 'finance-wire',
        fetchedAt: payload.timestamp,
      }))
      .filter(Boolean),
    item => item.publishedAt
  );
}

function mergeChinaNewsItems(items = []) {
  const merged = new Map();
  for (const item of sortByNewest(items, entry => entry.publishedAt)) {
    const normalizedTitle = buildEventKey(item.title) || item.title.toLowerCase();
    const key = item.url || `${item.source}|${normalizedTitle}`;
    if (!merged.has(key)) {
      merged.set(key, item);
      continue;
    }

    const existing = merged.get(key);
    if ((item.summary || '').length > (existing.summary || '').length) existing.summary = item.summary;
    if (!existing.url && item.url) existing.url = item.url;
    if (!existing.series && item.series) existing.series = item.series;
    if (getTimeValue(item.publishedAt) > getTimeValue(existing.publishedAt)) existing.publishedAt = item.publishedAt;
  }
  return sortByNewest([...merged.values()], entry => entry.publishedAt);
}

function normalizeHeadlineForSimilarity(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/【[^】]{1,20}】/g, ' ')
    .replace(/\[[^\]]{1,20}\]/g, ' ')
    .replace(/[“”"'《》<>（）()【】\[\]{}:：,，.。!！?？、|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function buildHeadlineSignature(title) {
  const normalized = normalizeHeadlineForSimilarity(title);
  const grams = new Set();
  for (let index = 0; index < Math.max(0, normalized.length - 1); index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return { normalized, grams };
}

function headlineSimilarity(left, right) {
  if (!left?.normalized || !right?.normalized) return 0;
  if (left.normalized === right.normalized) return 1;
  if (
    left.normalized.length >= 10 &&
    right.normalized.length >= 10 &&
    (left.normalized.includes(right.normalized) || right.normalized.includes(left.normalized))
  ) {
    return 0.86;
  }

  let overlap = 0;
  for (const gram of left.grams) {
    if (right.grams.has(gram)) overlap += 1;
  }
  const union = left.grams.size + right.grams.size - overlap;
  return union > 0 ? overlap / union : 0;
}

function detectHeadlineStance(text) {
  const value = String(text || '');
  if (!value) return 'neutral';
  if (CHINA_NEWS_DENY_HINTS.some(keyword => value.includes(keyword))) return 'deny';

  let positive = 0;
  let negative = 0;
  for (const keyword of CHINA_NEWS_POSITIVE_HINTS) {
    if (value.includes(keyword)) positive += 1;
  }
  for (const keyword of CHINA_NEWS_NEGATIVE_HINTS) {
    if (value.includes(keyword)) negative += 1;
  }
  if (positive > negative && positive > 0) return 'up';
  if (negative > positive && negative > 0) return 'down';
  if (CHINA_NEWS_CONFIRM_HINTS.some(keyword => value.includes(keyword))) return 'confirm';
  return 'neutral';
}

function describeClusterConflict(stances) {
  if (stances.includes('deny') && stances.some(stance => stance !== 'deny')) {
    return 'same topic shows denial versus confirmation/escalation wording';
  }
  if (stances.includes('up') && stances.includes('down')) {
    return 'same topic mixes positive versus negative direction wording';
  }
  return 'same topic shows divergent wording';
}

function getFreshnessBucket(timestamp) {
  const ageMinutes = Math.max(0, Math.floor((Date.now() - getTimeValue(timestamp)) / 60000));
  if (ageMinutes <= 20) return 'realtime';
  if (ageMinutes <= 120) return 'flash';
  if (ageMinutes <= 720) return 'follow';
  return 'background';
}

function buildChinaNewsClusters(items = []) {
  const clusters = [];
  for (const item of sortByOldest(items, entry => entry.publishedAt)) {
    const signature = buildHeadlineSignature(item.title);
    const enriched = {
      ...item,
      signature,
      stance: detectHeadlineStance(`${item.title} ${item.summary}`),
    };

    let bestCluster = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = headlineSimilarity(signature, cluster.signature);
      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestScore >= 0.38) {
      bestCluster.items.push(enriched);
      if ((item.summary || '').length > (bestCluster.summary || '').length) bestCluster.summary = item.summary;
      if (getTimeValue(item.publishedAt) > getTimeValue(bestCluster.latestAt)) {
        bestCluster.latestAt = item.publishedAt;
        bestCluster.latestSource = item.source;
        bestCluster.latestSeries = item.series || bestCluster.latestSeries || null;
      }
      if (getTimeValue(item.publishedAt) < getTimeValue(bestCluster.firstSeen)) {
        bestCluster.firstSeen = item.publishedAt;
      }
      continue;
    }

    clusters.push({
      id: `cn-${clusters.length + 1}`,
      headline: item.title,
      summary: item.summary,
      latestAt: item.publishedAt,
      firstSeen: item.publishedAt,
      leadUrl: item.url,
      leadSource: item.source,
      leadSeries: item.series || null,
      latestSource: item.source,
      latestSeries: item.series || null,
      signature,
      items: [enriched],
    });
  }

  return sortByNewest(clusters.map(cluster => {
    const itemsSorted = sortByNewest(cluster.items, entry => entry.publishedAt);
    const sources = [...new Set(itemsSorted.map(entry => entry.source))];
    const stances = [...new Set(itemsSorted.map(entry => entry.stance).filter(stance => stance && stance !== 'neutral'))];
    const conflict = (
      (stances.includes('deny') && stances.some(stance => stance !== 'deny')) ||
      (stances.includes('up') && stances.includes('down'))
    );

    return {
      id: cluster.id,
      headline: cluster.headline,
      summary: cluster.summary,
      latestAt: cluster.latestAt,
      firstSeen: cluster.firstSeen,
      eventAt: cluster.firstSeen,
      leadUrl: cluster.leadUrl,
      leadSource: cluster.leadSource,
      leadSeries: cluster.leadSeries || null,
      latestSource: cluster.latestSource,
      latestSeries: cluster.latestSeries || null,
      itemCount: itemsSorted.length,
      sourceCount: sources.length,
      sources,
      freshness: getFreshnessBucket(cluster.firstSeen),
      conflict,
      conflictReason: conflict ? describeClusterConflict(stances) : '',
      items: itemsSorted.slice(0, 6).map(entry => ({
        source: entry.source,
        title: entry.title,
        summary: entry.summary,
        series: entry.series || null,
        url: entry.url,
        publishedAt: entry.publishedAt,
        freshness: getFreshnessBucket(entry.publishedAt),
      })),
    };
  }), cluster => cluster.firstSeen);
}

function buildChinaNewsFlow(items = [], clusters = []) {
  const now = Date.now();
  const sourceCounts = new Map();
  const buckets = Array.from({ length: 12 }, (_, index) => ({
    label: `${11 - index}h`,
    count: 0,
  }));

  for (const item of items) {
    const current = sourceCounts.get(item.source) || {
      source: item.source,
      count: 0,
      realtimeCount: 0,
      latestAt: item.publishedAt,
    };
    current.count += 1;
    if (getFreshnessBucket(item.publishedAt) !== 'background') current.realtimeCount += 1;
    if (getTimeValue(item.publishedAt) > getTimeValue(current.latestAt)) current.latestAt = item.publishedAt;
    sourceCounts.set(item.source, current);

    const ageHours = Math.floor((now - getTimeValue(item.publishedAt)) / 3600000);
    if (ageHours >= 0 && ageHours < 12) {
      buckets[11 - ageHours].count += 1;
    }
  }

  const freshness = [15, 60, 180, 720].map(limit => ({
    label: `${limit}m`,
    count: items.filter(item => (now - getTimeValue(item.publishedAt)) <= limit * 60000).length,
  }));

  return {
    sourceCounts: sortByNewest([...sourceCounts.values()], entry => entry.latestAt),
    buckets,
    freshness,
    multiSourceClusters: clusters.filter(cluster => cluster.sourceCount > 1).length,
    conflictClusters: clusters.filter(cluster => cluster.conflict).length,
  };
}

async function fetchChinaNewsBundle(hotNewsPayload = {}, cnFinanceRssPayload = {}, clsTelegraphPayload = {}) {
  const results = await Promise.allSettled(CHINA_NEWS_SOURCES.map(fetchChinaNewsSource));
  const directItems = results
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value || []);
  const hotNewsItems = normalizeHotNewsItems(hotNewsPayload).slice(0, 24);
  const cnRssItems = normalizeCnFinanceRssItems(cnFinanceRssPayload).slice(0, 30);
  const clsDirectItems = normalizeClsTelegraphDirectItems(clsTelegraphPayload).slice(0, 30);
  const items = mergeChinaNewsItems([...directItems, ...hotNewsItems, ...cnRssItems, ...clsDirectItems]).slice(0, 120);
  const clusters = buildChinaNewsClusters(items).slice(0, 80);
  const flow = buildChinaNewsFlow(items, clusters);

  const summary = {
    totalItems: items.length,
    sourceCount: new Set(items.map(item => item.source)).size,
    realtimeCount: items.filter(item => getFreshnessBucket(item.publishedAt) !== 'background').length,
    multiSourceCount: clusters.filter(cluster => cluster.sourceCount > 1).length,
    conflictCount: clusters.filter(cluster => cluster.conflict).length,
    hotWireCount: hotNewsItems.length,
  };

  const signals = [];
  if (summary.realtimeCount >= 8) {
    signals.push(`CHINA NEWS FLOW: ${summary.realtimeCount} items updated within 12h across ${summary.sourceCount} domestic sources`);
  }
  if (summary.multiSourceCount >= 3) {
    signals.push(`CHINA NEWS CONSENSUS: ${summary.multiSourceCount} same-topic clusters confirmed by multiple mainland sources`);
  }
  if (summary.conflictCount > 0) {
    signals.push(`CHINA NEWS CONFLICT: ${summary.conflictCount} clusters show conflicting or denial-versus-confirmation wording`);
  }

  return {
    items,
    clusters,
    flow,
    summary,
    signals,
    mapItems: items.filter(item => item.lat != null && item.lon != null).slice(0, 24).map(item => ({
      title: item.title,
      source: item.source,
      date: item.publishedAt,
      url: item.url,
      lat: item.lat,
      lon: item.lon,
      region: item.region,
    })),
  };
}

const RSS_SOURCE_FALLBACKS = {
  'SBS Australia': { lat: -35.2809, lon: 149.13, region: 'Australia' },
  'Indian Express': { lat: 28.6139, lon: 77.209, region: 'India' },
  'The Hindu': { lat: 13.0827, lon: 80.2707, region: 'India' },
  'MercoPress': { lat: -34.9011, lon: -56.1645, region: 'South America' },
  'CLS Telegraph': { lat: 31.2304, lon: 121.4737, region: 'China' },
  'WallStreetCN Live': { lat: 31.2304, lon: 121.4737, region: 'China' },
  ...CHINA_NEWS_SOURCE_FALLBACKS,
};
const REGIONAL_NEWS_SOURCES = ['MercoPress', 'Indian Express', 'The Hindu', 'SBS Australia'];
const NEWSNOW_REALTIME_SOURCES = [
  { id: 'cls-telegraph', source: 'CLS Telegraph' },
  { id: 'wallstreetcn-quick', source: 'WallStreetCN Live' },
];
const NEWSNOW_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://newsnow.busiyi.world/c/realtime',
  'Origin': 'https://newsnow.busiyi.world',
};

async function fetchNewsNowRealtime() {
  const results = await Promise.allSettled(
    NEWSNOW_REALTIME_SOURCES.map(async ({ id, source }) => {
      const payload = await fetchJsonWithTimeout(`https://newsnow.busiyi.world/api/s?id=${id}&latest=true`, 10000, NEWSNOW_BROWSER_HEADERS);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      return items.slice(0, 20).map(item => ({
        title: (item.title || '').trim(),
        date: item.pubDate || item.extra?.date || payload?.updatedTime || Date.now(),
        source,
        url: sanitizeExternalUrl(item.url || item.mobileUrl),
      })).filter(item => item.title);
    })
  );

  return results
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value);
}

export async function fetchAllNews(extraNews = []) {
  const feeds = [
    // Global
    ['http://feeds.bbci.co.uk/news/world/rss.xml', 'BBC'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'NYT'],
    ['https://www.aljazeera.com/xml/rss/all.xml', 'Al Jazeera'],
    // USA
    ['https://feeds.npr.org/1001/rss.xml', 'NPR'],
    ['https://feeds.bbci.co.uk/news/technology/rss.xml', 'BBC Tech'],
    ['http://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'BBC Science'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/Americas.xml', 'NYT Americas'],
    // Europe
    ['https://rss.dw.com/rdf/rss-en-all', 'DW'],
    ['https://www.france24.com/en/rss', 'France 24'],
    ['https://www.euronews.com/rss?format=mrss', 'Euronews'],
    // Africa & Cameroon region
    ['https://rss.dw.com/rdf/rss-en-africa', 'DW Africa'],
    ['https://www.rfi.fr/en/rss', 'RFI'],
    ['https://www.africanews.com/feed/rss', 'Africa News'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/Africa.xml', 'NYT Africa'],
    // Asia-Pacific
    ['https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml', 'NYT Asia'],
    ['https://www.sbs.com.au/news/topic/australia/feed', 'SBS Australia'],
    // India
    ['https://indianexpress.com/section/india/feed/', 'Indian Express'],
    ['https://www.thehindu.com/news/national/feeder/default.rss', 'The Hindu'],
    // South America
    ['https://en.mercopress.com/rss/latin-america', 'MercoPress'],
  ];

  const [results, realtimeWireNews] = await Promise.all([
    Promise.allSettled(feeds.map(([url, source]) => fetchRSS(url, source))),
    fetchNewsNowRealtime().catch(() => []),
  ]);

  const allNews = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .concat(realtimeWireNews || [])
    .concat(extraNews || []);

  // De-duplicate and geo-tag
  const seen = new Set();
  const geoNews = [];
  for (const item of allNews) {
    const key = item.title.substring(0, 40).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const geo = (item.lat != null && item.lon != null)
      ? { lat: item.lat, lon: item.lon, region: item.region || 'Global' }
      : (geoTagText(item.title) || RSS_SOURCE_FALLBACKS[item.source]);
    if (geo) {
      geoNews.push({
        title: item.title.substring(0, 100),
        source: item.source,
        date: item.date,
        url: item.url,
        lat: geo.lat + (Math.random() - 0.5) * 2,
        lon: geo.lon + (Math.random() - 0.5) * 2,
        region: geo.region
      });
    }
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const filtered = geoNews.filter(n => !n.date || new Date(n.date) >= cutoff);
  filtered.sort((a, b) => getTimeValue(b.date) - getTimeValue(a.date));

  const selected = [];
  const selectedKeys = new Set();
  const keyFor = item => `${item.source}|${item.title}|${item.date}`;
  const pushUnique = item => {
    const key = keyFor(item);
    if (selectedKeys.has(key)) return;
    selected.push(item);
    selectedKeys.add(key);
  };

  filtered.forEach(pushUnique);
  return selected.slice(0, 80);
}

// === Leverageable Ideas from Signals ===
export function generateIdeas(V2) {
  const ideas = [];
  const vix = V2.fred.find(f => f.id === 'VIXCLS');
  const hy = V2.fred.find(f => f.id === 'BAMLH0A0HYM2');
  const spread = V2.fred.find(f => f.id === 'T10Y2Y');

  if (V2.tg.urgent.length > 3 && V2.energy.wti > 68) {
    ideas.push({
      title: 'Conflict-Energy Nexus Active',
      text: `${V2.tg.urgent.length} urgent conflict signals with WTI at $${V2.energy.wti}. Geopolitical risk premium may expand. Consider energy exposure.`,
      type: 'long', confidence: 'Medium', horizon: 'swing'
    });
  }
  if (vix && vix.value > 20) {
    ideas.push({
      title: 'Elevated Volatility Regime',
      text: `VIX at ${vix.value} — fear premium elevated. Portfolio hedges justified. Short-term equity upside is capped.`,
      type: 'hedge', confidence: vix.value > 25 ? 'High' : 'Medium', horizon: 'tactical'
    });
  }
  if (vix && vix.value > 20 && hy && hy.value > 3) {
    ideas.push({
      title: 'Safe Haven Demand Rising',
      text: `VIX ${vix.value} + HY spread ${hy.value}% = risk-off building. Gold, treasuries, quality dividends may outperform.`,
      type: 'hedge', confidence: 'Medium', horizon: 'tactical'
    });
  }
  if (V2.energy.wtiRecent.length > 1) {
    const latest = V2.energy.wtiRecent[0];
    const oldest = V2.energy.wtiRecent[V2.energy.wtiRecent.length - 1];
    const pct = ((latest - oldest) / oldest * 100).toFixed(1);
    if (Math.abs(pct) > 3) {
      ideas.push({
        title: pct > 0 ? 'Oil Momentum Building' : 'Oil Under Pressure',
        text: `WTI moved ${pct > 0 ? '+' : ''}${pct}% recently to $${V2.energy.wti}/bbl. ${pct > 0 ? 'Energy and commodity names benefit.' : 'Demand concerns may be emerging.'}`,
        type: pct > 0 ? 'long' : 'watch', confidence: 'Medium', horizon: 'swing'
      });
    }
  }
  if (spread) {
    ideas.push({
      title: spread.value > 0 ? 'Yield Curve Normalizing' : 'Yield Curve Inverted',
      text: `10Y-2Y spread at ${spread.value.toFixed(2)}. ${spread.value > 0 ? 'Recession signal fading — cyclical rotation possible.' : 'Inversion persists — defensive positioning warranted.'}`,
      type: 'watch', confidence: 'Medium', horizon: 'strategic'
    });
  }
  const debt = parseFloat(V2.treasury.totalDebt);
  if (debt > 35e12) {
    ideas.push({
      title: 'Fiscal Trajectory Supports Hard Assets',
      text: `National debt at $${(debt / 1e12).toFixed(1)}T. Long-term gold, bitcoin, and real asset appreciation thesis intact.`,
      type: 'long', confidence: 'High', horizon: 'strategic'
    });
  }
  const totalThermal = V2.thermal.reduce((s, t) => s + t.det, 0);
  if (totalThermal > 30000 && V2.tg.urgent.length > 2) {
    ideas.push({
      title: 'Satellite Confirms Conflict Intensity',
      text: `${totalThermal.toLocaleString()} thermal detections + ${V2.tg.urgent.length} urgent OSINT flags. Defense sector procurement may accelerate.`,
      type: 'watch', confidence: 'Medium', horizon: 'swing'
    });
  }

  // Yield Curve + Labor Interaction
  const unemployment = V2.bls.find(b => b.id === 'LNS14000000' || b.id === 'UNRATE');
  const payrolls = V2.bls.find(b => b.id === 'CES0000000001' || b.id === 'PAYEMS');
  if (spread && unemployment && payrolls) {
    const weakLabor = (unemployment.value > 4.3) || (payrolls.momChange && payrolls.momChange < -50);
    if (spread.value > 0.3 && weakLabor) {
      ideas.push({
        title: 'Steepening Curve Meets Weak Labor',
        text: `10Y-2Y at ${spread.value.toFixed(2)} + UE ${unemployment.value}%. Curve steepening with deteriorating employment = recession positioning warranted.`,
        type: 'hedge', confidence: 'High', horizon: 'tactical'
      });
    }
  }

  // ACLED Conflict + Energy Momentum
  const conflictEvents = V2.acled?.totalEvents || 0;
  if (conflictEvents > 50 && V2.energy.wtiRecent.length > 1) {
    const wtiMove = V2.energy.wtiRecent[0] - V2.energy.wtiRecent[V2.energy.wtiRecent.length - 1];
    if (wtiMove > 2) {
      ideas.push({
        title: 'Conflict Fueling Energy Momentum',
        text: `${conflictEvents} ACLED events this week + WTI up $${wtiMove.toFixed(1)}. Conflict-energy transmission channel active.`,
        type: 'long', confidence: 'Medium', horizon: 'swing'
      });
    }
  }

  // Defense + Conflict Intensity
  const totalFatalities = V2.acled?.totalFatalities || 0;
  const totalThermalAll = V2.thermal.reduce((s, t) => s + t.det, 0);
  if (totalFatalities > 500 && totalThermalAll > 20000) {
    ideas.push({
      title: 'Defense Procurement Acceleration Signal',
      text: `${totalFatalities.toLocaleString()} conflict fatalities + ${totalThermalAll.toLocaleString()} thermal detections. Defense contractors may see accelerated procurement.`,
      type: 'long', confidence: 'Medium', horizon: 'swing'
    });
  }

  // HY Spread + VIX Divergence
  if (hy && vix) {
    const hyWide = hy.value > 3.5;
    const vixLow = vix.value < 18;
    const hyTight = hy.value < 2.5;
    const vixHigh = vix.value > 25;
    if (hyWide && vixLow) {
      ideas.push({
        title: 'Credit Stress Ignored by Equity Vol',
        text: `HY spread ${hy.value.toFixed(1)}% (wide) but VIX only ${vix.value.toFixed(0)} (complacent). Equity may be underpricing credit deterioration.`,
        type: 'watch', confidence: 'Medium', horizon: 'tactical'
      });
    } else if (hyTight && vixHigh) {
      ideas.push({
        title: 'Equity Fear Exceeds Credit Stress',
        text: `VIX at ${vix.value.toFixed(0)} but HY spread only ${hy.value.toFixed(1)}%. Equity vol may be overshooting — credit markets aren't confirming.`,
        type: 'watch', confidence: 'Medium', horizon: 'tactical'
      });
    }
  }

  // Supply Chain + Inflation Pipeline
  const ppi = V2.bls.find(b => b.id === 'WPUFD49104' || b.id === 'PCU--PCU--');
  const cpi = V2.bls.find(b => b.id === 'CUUR0000SA0' || b.id === 'CPIAUCSL');
  if (ppi && cpi && V2.gscpi) {
    const supplyPressure = V2.gscpi.value > 0.5;
    const ppiRising = ppi.momChangePct > 0.3;
    if (supplyPressure && ppiRising) {
      ideas.push({
        title: 'Inflation Pipeline Building Pressure',
        text: `GSCPI at ${V2.gscpi.value.toFixed(2)} (${V2.gscpi.interpretation}) + PPI momentum +${ppi.momChangePct?.toFixed(1)}%. Input costs flowing through — CPI may follow.`,
        type: 'long', confidence: 'Medium', horizon: 'strategic'
      });
    }
  }

  return ideas.slice(0, 8);
}

// === Synthesize raw sweep data into dashboard format ===
export async function synthesize(data) {
  const liveAirHotspots = data.sources.OpenSky?.hotspots || [];
  const airFallback = sumAirHotspots(liveAirHotspots) > 0
    ? null
    : loadOpenSkyFallback(data.sources.OpenSky?.timestamp || data.crucix?.timestamp);
  const effectiveAirHotspots = airFallback?.hotspots || liveAirHotspots;
  const air = summarizeAirHotspots(effectiveAirHotspots);
  const thermal = (data.sources.FIRMS?.hotspots || []).map(h => ({
    region: h.region, det: h.totalDetections || 0, night: h.nightDetections || 0,
    hc: h.highConfidence || 0,
    fires: (h.highIntensity || []).slice(0, 8).map(f => ({ lat: f.lat, lon: f.lon, frp: f.frp || 0 }))
  }));
  const chokepoints = Object.values(data.sources.Maritime?.chokepoints || {}).map(c => ({
    label: c.label || c.name, note: c.note || '', lat: c.lat || 0, lon: c.lon || 0
  }));
  const nuke = (data.sources.Safecast?.sites || []).map(s => ({
    site: s.site, anom: s.anomaly || false, cpm: s.avgCPM, n: s.recentReadings || 0
  }));
  const nukeSignals = normalizeSignalList(data.sources.Safecast?.signals || []);
  const sdrData = data.sources.KiwiSDR || {};
  const sdrNet = sdrData.network || {};
  const sdrConflict = sdrData.conflictZones || {};
  const sdrZones = Object.values(sdrConflict).map(z => ({
    region: z.region, count: z.count || 0,
    receivers: (z.receivers || []).slice(0, 5).map(r => ({ name: r.name || '', lat: r.lat || 0, lon: r.lon || 0 }))
  }));
  const tgData = data.sources.Telegram || {};
  const tgUrgent = dedupeTelegramPosts((tgData.urgentPosts || []).map(p => ({
    channel: p.channel,
    text: p.text,
    views: p.views,
    date: p.date,
    urgentFlags: p.urgentFlags || []
  })));
  const urgentKeys = new Set(tgUrgent.map(post => buildEventKey(post.text)));
  const tgTop = dedupeTelegramPosts((tgData.topPosts || []).map(p => ({
    channel: p.channel,
    text: p.text,
    views: p.views,
    date: p.date,
    urgentFlags: []
  }))).filter(post => !urgentKeys.has(buildEventKey(post.text)));
  const tgRecent = dedupeTelegramPosts((tgData.recentPosts || []).map(p => ({
    channel: p.channel,
    text: p.text,
    views: p.views,
    date: p.date,
    urgentFlags: p.urgentFlags || [],
  })));
  const who = sortByNewest(
    (data.sources.WHO?.diseaseOutbreakNews || []).map(w => ({
      title: w.title?.substring(0, 120), date: w.date, summary: w.summary?.substring(0, 150)
    })),
    item => item.date
  ).slice(0, 10);
  const fred = (data.sources.FRED?.indicators || []).map(f => ({
    id: f.id, label: f.label, value: f.value, date: f.date,
    recent: f.recent || [],
    momChange: f.momChange, momChangePct: f.momChangePct
  }));
  const energyData = data.sources.EIA || {};
  const oilPrices = energyData.oilPrices || {};
  const wtiRecent = (oilPrices.wti?.recent || []).map(d => d.value);
  const energy = {
    wti: oilPrices.wti?.value, brent: oilPrices.brent?.value,
    natgas: energyData.gasPrice?.value, crudeStocks: energyData.inventories?.crudeStocks?.value,
    wtiRecent, signals: energyData.signals || []
  };
  const bls = data.sources.BLS?.indicators || [];
  const treasuryData = data.sources.Treasury || {};
  const debtArr = treasuryData.debt || [];
  const treasury = { totalDebt: debtArr[0]?.totalDebt || '0', signals: treasuryData.signals || [] };
  const gscpi = data.sources.GSCPI?.latest || null;
  const defense = (data.sources.USAspending?.recentDefenseContracts || []).slice(0, 5).map(c => ({
    recipient: c.recipient?.substring(0, 40), amount: c.amount, desc: c.description?.substring(0, 80)
  }));
  const noaa = {
    totalAlerts: data.sources.NOAA?.totalSevereAlerts || 0,
    alerts: (data.sources.NOAA?.topAlerts || []).filter(a => a.lat != null && a.lon != null).slice(0, 10).map(a => ({
      event: a.event, severity: a.severity, headline: a.headline?.substring(0, 120),
      lat: a.lat, lon: a.lon
    }))
  };

  // EPA RadNet — pass through geo-tagged readings
  const epaData = data.sources.EPA || {};
  const epaStations = [];
  const seenEpa = new Set();
  for (const r of (epaData.readings || [])) {
    if (r.lat == null || r.lon == null) continue;
    const key = `${r.lat},${r.lon}`;
    if (seenEpa.has(key)) continue;
    seenEpa.add(key);
    epaStations.push({ location: r.location, state: r.state, lat: r.lat, lon: r.lon, analyte: r.analyte, result: r.result, unit: r.unit });
  }
  const epa = { totalReadings: epaData.totalReadings || 0, stations: epaStations.slice(0, 10) };

  // Disaster stack — USGS earthquakes + NASA EONET natural events
  const usgsData = data.sources['USGS-Earthquakes'] || {};
  const eonetData = data.sources['NASA-EONET'] || {};
  const disaster = {
    quakeCount24h: usgsData.summary?.total24h || 0,
    significantQuakes: usgsData.summary?.significantCount || 0,
    majorQuakes: usgsData.summary?.majorCount || 0,
    tsunamiCount: usgsData.summary?.tsunamiCount || 0,
    maxMagnitude24h: usgsData.summary?.maxMagnitude || 0,
    topRegions: (usgsData.topRegions || []).slice(0, 6).map(region => ({
      region: region.region,
      count: region.count,
    })),
    earthquakes: sortByNewest(usgsData.earthquakes || [], quake => quake.time).slice(0, 15).map(quake => ({
      id: quake.id,
      magnitude: quake.magnitude,
      place: quake.place,
      region: quake.region,
      time: quake.time,
      lat: quake.lat,
      lon: quake.lon,
      depthKm: quake.depthKm,
      tsunami: Boolean(quake.tsunami),
      alert: quake.alert,
      significance: quake.significance || 0,
      url: quake.url,
    })),
    openEvents: eonetData.openEvents || 0,
    categories: eonetData.categories || {},
    events: sortByNewest(eonetData.events || [], event => event.date).slice(0, 15).map(event => ({
      id: event.id,
      title: event.title,
      category: event.category,
      categoryId: event.categoryId,
      source: event.source,
      date: event.date,
      lat: event.lat,
      lon: event.lon,
      magnitudeValue: event.magnitudeValue,
      magnitudeUnit: event.magnitudeUnit,
      link: event.link,
    })),
    signals: normalizeSignalList([...(usgsData.signals || []), ...(eonetData.signals || [])]).slice(0, 8),
  };

  // World Bank structural macro layer
  const worldBankData = data.sources.WorldBank || {};
  const world = {
    profiles: (worldBankData.profiles || []).map(profile => ({
      code: profile.code,
      name: profile.name,
      gdp: profile.gdp ?? null,
      inflation: profile.inflation ?? null,
      tradePct: profile.tradePct ?? null,
      militaryPct: profile.militaryPct ?? null,
      dates: profile.dates || {},
    })),
    gdpLeaders: (worldBankData.gdpLeaders || []).slice(0, 5).map(profile => ({
      name: profile.name,
      code: profile.code,
      gdp: profile.gdp,
      date: profile.dates?.gdp || null,
    })),
    inflationLeaders: (worldBankData.inflationLeaders || []).slice(0, 5).map(profile => ({
      name: profile.name,
      code: profile.code,
      inflation: profile.inflation,
      date: profile.dates?.inflation || null,
    })),
    tradeExposure: (worldBankData.tradeExposure || []).slice(0, 5).map(profile => ({
      name: profile.name,
      code: profile.code,
      tradePct: profile.tradePct,
      date: profile.dates?.tradePct || null,
    })),
    militaryBurden: (worldBankData.militaryBurden || []).slice(0, 5).map(profile => ({
      name: profile.name,
      code: profile.code,
      militaryPct: profile.militaryPct,
      date: profile.dates?.militaryPct || null,
    })),
    signals: normalizeSignalList(worldBankData.signals || []),
  };
  const hotNewsData = data.sources['Hot-News'] || {};
  const cnFinanceRssData = data.sources['CN-Finance-RSS'] || {};
  const clsTelegraphData = data.sources['CLS-Telegraph'] || {};
  const aviationData = data.sources.Flightera || {};
  const aviation = {
    configured: Boolean(aviationData.configured),
    airports: aviationData.airports || [],
    stats: [...(aviationData.stats || [])]
      .sort((left, right) => (right.delayedPercent || 0) - (left.delayedPercent || 0))
      .slice(0, 8),
    note: aviationData.note || '',
    signals: normalizeSignalList(aviationData.signals || []),
  };

  // Space/CelesTrak satellite data
  const spaceData = data.sources.Space || {};
  const spaceNewsData = data.sources['Spaceflight-News'] || {};
  const launchLibraryData = data.sources['Launch-Library'] || {};
  // Approximate subsatellite position from TLE orbital elements
  function estimateSatPosition(sat) {
    if (!sat?.inclination || !sat?.epoch) return null;
    const epoch = new Date(sat.epoch);
    const now = new Date();
    const elapsed = (now - epoch) / 1000;
    const period = (sat.period || 92.7) * 60; // minutes to seconds
    const orbits = elapsed / period;
    const frac = orbits % 1;
    const lat = sat.inclination * Math.sin(frac * 2 * Math.PI);
    const lonShift = (elapsed / 86400) * 360;
    const orbitLon = frac * 360;
    const lon = ((orbitLon - lonShift) % 360 + 540) % 360 - 180;
    return { lat: +lat.toFixed(2), lon: +lon.toFixed(2), name: sat.name };
  }
  const issPos = estimateSatPosition(spaceData.iss);
  const spaceStations = (spaceData.spaceStations || []).map(s => estimateSatPosition(s)).filter(Boolean);
  const issAltitudeKm = Number.isFinite(spaceData.iss?.apogee) && Number.isFinite(spaceData.iss?.perigee)
    ? (spaceData.iss.apogee + spaceData.iss.perigee) / 2
    : null;
  const spaceHeadlines = sortByNewest(spaceNewsData.articles || [], article => article.publishedAt).slice(0, 6).map(article => ({
    title: article.title,
    source: article.source,
    publishedAt: article.publishedAt,
    summary: article.summary,
    url: article.url,
  }));
  const now = Date.now();
  const upcomingLaunches = (launchLibraryData.launches || [])
    .filter(launch => {
      const net = new Date(launch.net || 0).getTime();
      return Number.isFinite(net) && net >= (now - 30 * 60 * 1000);
    })
    .slice(0, 8)
    .map(launch => ({
    id: launch.id,
    name: launch.name,
    net: launch.net,
    status: launch.status,
    provider: launch.provider,
    probability: launch.probability,
    weatherConcerns: launch.weatherConcerns,
    missionType: launch.missionType,
    missionName: launch.missionName,
    orbit: launch.orbit,
    pad: launch.pad,
    lat: launch.lat,
    lon: launch.lon,
    country: launch.country,
    url: launch.url,
  }));
  const spaceSignals = normalizeSignalList([
    ...(spaceData.signals || []),
    ...(launchLibraryData.signals || []),
    ...(spaceNewsData.signals || []),
  ]);
  const space = {
    totalNewObjects: spaceData.totalNewObjects || 0,
    militarySats: spaceData.militarySatellites || 0,
    militaryByCountry: spaceData.militaryByCountry || {},
    constellations: spaceData.constellations || {},
    iss: spaceData.iss || null,
    issAltitudeKm,
    issPosition: issPos,
    stationPositions: spaceStations.slice(0, 5),
    recentLaunches: (spaceData.recentLaunches || []).slice(0, 10).map(l => ({
      name: l.name, country: l.country, epoch: l.epoch,
      apogee: l.apogee, perigee: l.perigee, type: l.objectType
    })),
    launchByCountry: spaceData.launchByCountry || {},
    upcomingCount: launchLibraryData.upcomingCount || 0,
    next72h: launchLibraryData.next72h || 0,
    providerMix: launchLibraryData.byProvider || {},
    upcomingLaunches,
    headlines: spaceHeadlines,
    signals: spaceSignals.slice(0, 8),
  };

  // ACLED conflict events
  const acledData = data.sources.ACLED || {};
  const acled = acledData.error ? { totalEvents: 0, totalFatalities: 0, byRegion: {}, byType: {}, deadliestEvents: [] } : {
    totalEvents: acledData.totalEvents || 0,
    totalFatalities: acledData.totalFatalities || 0,
    byRegion: acledData.byRegion || {},
    byType: acledData.byType || {},
    deadliestEvents: (acledData.deadliestEvents || []).slice(0, 15).map(e => ({
      date: e.date, type: e.type, country: e.country, location: e.location,
      fatalities: e.fatalities || 0, lat: e.lat || null, lon: e.lon || null
    }))
  };

  // GDELT news articles + geo events
  const gdeltData = data.sources.GDELT || {};
  const gdelt = {
    totalArticles: gdeltData.totalArticles || 0,
    conflicts: (gdeltData.conflicts || []).length,
    economy: (gdeltData.economy || []).length,
    health: (gdeltData.health || []).length,
    crisis: (gdeltData.crisis || []).length,
    topTitles: (gdeltData.allArticles || []).slice(0, 5).map(a => a.title?.substring(0, 80)),
    geoPoints: (gdeltData.geoPoints || []).slice(0, 20).map(p => ({
      lat: p.lat, lon: p.lon, name: (p.name || '').substring(0, 80), count: p.count || 1
    }))
  };

  // Cyber stack — NVD + CISA KEV
  const cisaKevData = data.sources['CISA-KEV'] || {};
  const nvdData = data.sources.NVD || {};
  const cyber = {
    summary: {
      critical: nvdData.summary?.critical || 0,
      high: nvdData.summary?.high || 0,
      medium: nvdData.summary?.medium || 0,
      rceCount: nvdData.summary?.rceCount || 0,
      authBypassCount: nvdData.summary?.authBypassCount || 0,
      kevRecent: cisaKevData.summary?.recentAdditions || 0,
      kevRansomware: cisaKevData.summary?.ransomwareLinked || 0,
    },
    recentCves: sortByNewest(nvdData.vulnerabilities || [], vulnerability => vulnerability.published).slice(0, 8).map(vulnerability => ({
      id: vulnerability.id,
      severity: vulnerability.severity,
      score: vulnerability.score,
      published: vulnerability.published,
      summary: vulnerability.summary,
      url: vulnerability.url,
    })),
    kevRecent: sortByNewest(cisaKevData.vulnerabilities || [], vulnerability => vulnerability.dateAdded).slice(0, 6).map(vulnerability => ({
      id: vulnerability.cveID,
      vendor: vulnerability.vendorProject,
      product: vulnerability.product,
      title: vulnerability.vulnerabilityName,
      dateAdded: vulnerability.dateAdded,
      ransomware: vulnerability.knownRansomwareCampaignUse === 'Known',
    })),
    signals: normalizeSignalList([...(cisaKevData.signals || []), ...(nvdData.signals || [])]).slice(0, 8),
  };

  // === Yahoo Finance live market data ===
  const yfData = data.sources.YFinance || {};
  const yfQuotes = yfData.quotes || {};
  const markets = {
    indexes: (yfData.indexes || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct, history: q.history || []
    })),
    asia: (yfData.asia || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct, history: q.history || []
    })),
    china: (yfData.china || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct, history: q.history || []
    })),
    rates: (yfData.rates || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct
    })),
    commodities: (yfData.commodities || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct, history: q.history || []
    })),
    crypto: (yfData.crypto || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct
    })),
    vix: yfQuotes['^VIX'] ? {
      value: yfQuotes['^VIX'].price,
      change: yfQuotes['^VIX'].change,
      changePct: yfQuotes['^VIX'].changePct,
    } : null,
    fx: (yfData.fx || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct
    })),
    chinaMonitor: yfData.chinaMonitor || { indexes: [], topGainers: [], topLosers: [], mainForce: [], northbound: null, summary: {}, signals: [] },
    timestamp: yfData.summary?.timestamp || null,
    chinaMarketSession: Boolean(yfData.summary?.chinaMarketSession),
    chinaCacheAgeMs: yfData.summary?.chinaCacheAgeMs || 0,
  };

  const hasAirFallback = sumAirHotspots(effectiveAirHotspots) > 0;
  const hasFredFallback = fred.length > 0 || (yfData.summary?.ok || 0) > 0;
  const hasEiaFallback = Boolean(yfQuotes['CL=F']?.price || yfQuotes['BZ=F']?.price || yfQuotes['NG=F']?.price);
  const health = Object.entries(data.sources).map(([name, src]) => {
    const degradedButUsable =
      (name === 'OpenSky' && Boolean(src.error) && hasAirFallback) ||
      (name === 'FRED' && Boolean(src.error) && hasFredFallback) ||
      (name === 'EIA' && Boolean(src.error) && hasEiaFallback);

    return {
      n: name,
      err: Boolean(src.error) && !degradedButUsable,
      stale: Boolean(src.stale || degradedButUsable)
    };
  });

  const tSignals = buildCrossSourceSignals(data, {
    tgUrgent,
    whoItems: who,
    markets,
  });

  const yfGold = yfQuotes['GC=F'];
  const yfSilver = yfQuotes['SI=F'];
  const metals = {
    gold: yfGold?.price,
    goldChange: yfGold?.change,
    goldChangePct: yfGold?.changePct,
    goldRecent: yfGold?.history?.map(h => h.close) || [],
    silver: yfSilver?.price,
    silverChange: yfSilver?.change,
    silverChangePct: yfSilver?.changePct,
    silverRecent: yfSilver?.history?.map(h => h.close) || [],
  };

  // Override stale EIA prices with live Yahoo Finance data if available
  const yfWti = yfQuotes['CL=F'];
  const yfBrent = yfQuotes['BZ=F'];
  const yfNatgas = yfQuotes['NG=F'];
  if (yfWti?.price) energy.wti = yfWti.price;
  if (yfBrent?.price) energy.brent = yfBrent.price;
  if (yfNatgas?.price) energy.natgas = yfNatgas.price;
  if (yfWti?.history?.length) energy.wtiRecent = yfWti.history.map(h => h.close);

  const chinaNews = await fetchChinaNewsBundle(hotNewsData, cnFinanceRssData, clsTelegraphData);
  const news = await fetchAllNews(chinaNews.mapItems);

  const V2 = {
    meta: data.crucix, air, thermal, tSignals, chokepoints, nuke, nukeSignals,
    airMeta: {
      fallback: Boolean(airFallback) || /Airplanes\.live/i.test(data.sources.OpenSky?.source || ''),
      liveTotal: sumAirHotspots(liveAirHotspots),
      timestamp: airFallback?.timestamp || data.sources.OpenSky?.timestamp || data.crucix?.timestamp || null,
      source: data.sources.OpenSky?.source || (airFallback ? 'OpenSky fallback' : 'OpenSky'),
      ...(airFallback ? { fallbackFile: airFallback.file } : {}),
      ...(Array.isArray(data.sources.OpenSky?.fallbackRegions) ? { fallbackRegions: data.sources.OpenSky.fallbackRegions } : {}),
      ...(data.sources.OpenSky?.error ? { error: data.sources.OpenSky.error } : {}),
    },
    sdr: { total: sdrNet.totalReceivers || 0, online: sdrNet.online || 0, zones: sdrZones },
    tg: { posts: tgData.totalPosts || 0, urgent: tgUrgent, topPosts: tgTop, recent: tgRecent.length ? tgRecent : [...tgUrgent, ...tgTop] },
    who, fred, energy, metals, bls, treasury, gscpi, defense, noaa, epa, disaster, world, cyber, acled, gdelt, space, health, news,
    cnNews: chinaNews,
    aviation,
    markets, // Live Yahoo Finance market data
    ideas: [], ideasSource: 'disabled',
    // newsFeed for ticker (merged RSS + GDELT + Telegram)
    newsFeed: buildNewsFeed(news, gdeltData, tgUrgent, tgTop, spaceHeadlines, hotNewsData.items || [], tgRecent),
    // Failed / exhausted source details for UI display
    sourceErrors: Array.isArray(data.errors) ? data.errors.map(e => ({ name: e.name || 'Unknown', error: String(e.error || '').slice(0, 120) })) : [],
  };

  return V2;
}

// === Unified News Feed for Ticker ===
function buildNewsFeed(rssNews, gdeltData, tgUrgent, tgTop, spaceArticles = [], hotNewsItems = [], tgRecent = []) {
  const feed = [];

  // RSS news
  for (const n of rssNews) {
    feed.push({
      headline: n.title, source: n.source, type: 'rss',
      timestamp: n.date, region: n.region, urgent: false, url: n.url
    });
  }

  // GDELT top articles
  for (const a of (gdeltData.allArticles || []).slice(0, 10)) {
    if (a.title) {
      const geo = geoTagText(a.title);
      feed.push({
        headline: a.title.substring(0, 100), source: 'GDELT', type: 'gdelt',
        timestamp: a.date || gdeltData.timestamp || new Date().toISOString(), region: geo?.region || 'Global', urgent: false, url: sanitizeExternalUrl(a.url)
      });
    }
  }

  // Space news
  for (const article of spaceArticles.slice(0, 6)) {
    if (!article?.title) continue;
    feed.push({
      headline: article.title.substring(0, 100),
      source: article.source || 'Spaceflight',
      type: 'space',
      timestamp: article.publishedAt,
      region: 'Space',
      urgent: false,
      url: sanitizeExternalUrl(article.url),
    });
  }

  for (const item of sortByNewest(hotNewsItems || [], entry => entry.publishedAt).slice(0, 12)) {
    if (!item?.title) continue;
    feed.push({
      headline: item.title.substring(0, 100),
      source: item.source || 'CLS Hot',
      type: 'china-wire',
      timestamp: item.publishedAt,
      region: 'China',
      urgent: /快讯|突发|盘中宝|风口研报|重磅|制裁|关税|油价|汇率/i.test(`${item.title} ${item.content || ''}`),
      url: sanitizeExternalUrl(item.url),
    });
  }

  // Telegram urgent
  for (const p of tgUrgent.slice(0, 10)) {
    const text = (p.text || '').replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
    feed.push({
      headline: text.substring(0, 100), source: p.channel?.toUpperCase() || 'TELEGRAM',
      type: 'telegram', timestamp: p.date, region: 'OSINT', urgent: true
    });
  }

  // Telegram top (non-urgent)
  for (const p of tgTop.slice(0, 5)) {
    const text = (p.text || '').replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
    feed.push({
      headline: text.substring(0, 100), source: p.channel?.toUpperCase() || 'TELEGRAM',
      type: 'telegram', timestamp: p.date, region: 'OSINT', urgent: false
    });
  }

  for (const p of tgRecent.slice(0, 12)) {
    const text = (p.text || '').replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
    if (!text) continue;
    feed.push({
      headline: text.substring(0, 100), source: p.channel?.toUpperCase() || 'TELEGRAM',
      type: 'telegram', timestamp: p.date, region: 'OSINT', urgent: (p.urgentFlags || []).length > 0
    });
  }

  // Filter to last 30 days, sort by timestamp descending, limit to 50
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = mergeFeedItemsByEvent(feed).filter(item => !item.timestamp || getTimeValue(item.timestamp) >= cutoff.getTime());
  recent.sort((a, b) => getTimeValue(b.timestamp) - getTimeValue(a.timestamp));

  const selected = [];
  const selectedKeys = new Set();
  const keyFor = item => `${item.type}|${item.source}|${item.headline}|${item.timestamp}`;
  const pushUnique = item => {
    const key = keyFor(item);
    if (selectedKeys.has(key)) return;
    selected.push(item);
    selectedKeys.add(key);
  };

  recent.forEach(pushUnique);
  return selected.slice(0, 120);
}

// === CLI Mode: inject into HTML file ===
function getCliArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function cliInject() {
  const data = JSON.parse(readFileSync(join(ROOT, 'runs/latest.json'), 'utf8'));
  const htmlOverride = getCliArg('--html');
  const shouldOpen = !process.argv.includes('--no-open');

  console.log('Fetching RSS news feeds...');
  const V2 = await synthesize(data);
  const llmProvider = createLLMProvider(config.llm);

  if (llmProvider?.isConfigured) {
    try {
      console.log(`[LLM] Generating ideas via ${llmProvider.name}...`);
      const llmIdeas = await generateLLMIdeas(llmProvider, V2, null, []);
      if (llmIdeas?.length) {
        V2.ideas = llmIdeas;
        V2.ideasSource = 'llm';
        console.log(`[LLM] Generated ${llmIdeas.length} ideas`);
      } else {
        V2.ideas = [];
        V2.ideasSource = 'llm-failed';
        console.log('[LLM] No ideas returned');
      }
    } catch (err) {
      V2.ideas = [];
      V2.ideasSource = 'llm-failed';
      console.log('[LLM] Idea generation failed:', err.message);
    }
  } else {
    V2.ideas = [];
    V2.ideasSource = 'disabled';
  }
  console.log(`Generated ${V2.ideas.length} leverageable ideas`);

  const json = JSON.stringify(V2);
  console.log('\n--- Synthesis ---');
  console.log('Size:', json.length, 'bytes | Air:', V2.air.length, '| Thermal:', V2.thermal.length,
    '| News:', V2.news.length, '| Ideas:', V2.ideas.length, '| Sources:', V2.health.length);

  const htmlPath = htmlOverride || join(ROOT, 'dashboard/public/jarvis.html');
  let html = readFileSync(htmlPath, 'utf8');
  // Use a replacer function so JSON is inserted literally even if it contains `$`.
  html = html.replace(/^(let|const) D = .*;\s*$/m, () => 'let D = ' + json + ';');
  writeFileSync(htmlPath, html);
  console.log('Data injected into jarvis.html!');

  if (!shouldOpen) return;

  // Auto-open dashboard in default browser
  // NOTE: On Windows, `start` in PowerShell is an alias for Start-Service, not cmd's start.
  // We must use `cmd /c start ""` to ensure it works in both cmd.exe and PowerShell.
  const openCmd = process.platform === 'win32' ? 'cmd /c start ""' :
                  process.platform === 'darwin' ? 'open' : 'xdg-open';
  const dashUrl = htmlPath.replace(/\\/g, '/');
  exec(`${openCmd} "${dashUrl}"`, (err) => {
    if (err) console.log('Could not auto-open browser:', err.message);
    else console.log('Dashboard opened in browser!');
  });
}

// Run CLI if invoked directly
const isMain = process.argv[1]
  && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMain) {
  await cliInject();
}
