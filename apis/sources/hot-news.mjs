// orz-ai/hot_news public API integration
// Adds China finance/trending wires that can be merged into the dashboard.

const BASE = 'https://orz.ai/api/v1/dailynews/';
const PLATFORMS = [
  { platform: 'cls', label: 'CLS Hot' },
  { platform: 'sina_finance', label: 'Sina Finance Hot' },
  { platform: 'eastmoney', label: 'Eastmoney Hot' },
  { platform: 'xueqiu', label: 'Xueqiu Hot' },
];

function normalizeTimestamp(value) {
  if (!value) return new Date().toISOString();
  if (/^\d{10,16}$/.test(String(value))) {
    const numeric = Number(value);
    const ms = String(value).length <= 10 ? numeric * 1000 : numeric;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function normalizeItem(item, source) {
  const title = String(item?.title || '').trim();
  if (!title) return null;
  return {
    title,
    content: String(item?.content || item?.desc || title).trim(),
    url: String(item?.url || '').trim() || null,
    source,
    publishedAt: normalizeTimestamp(item?.publish_time || item?.date || item?.timestamp),
    score: Number(item?.score || item?.hot || item?.rank || 0) || 0,
  };
}

function looksMojibake(text) {
  return /鈥|锟|鐨|鍦|浜|銆|闃|浠|鍙|鏈|鎴/u.test(text || '');
}

async function fetchPlatformPayload(platform) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${BASE}?platform=${platform}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Crucix/1.0',
        'Accept': 'application/json,text/plain,*/*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buffer = await res.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buffer);
    if (looksMojibake(text)) {
      text = new TextDecoder('gb18030').decode(buffer);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

export async function briefing() {
  const results = await Promise.allSettled(
    PLATFORMS.map(async ({ platform, label }) => {
      const payload = await fetchPlatformPayload(platform);
      const items = Array.isArray(payload?.data)
        ? payload.data.map(entry => normalizeItem(entry, label)).filter(Boolean)
        : [];
      return { platform, label, items };
    })
  );

  const platforms = {};
  const items = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    platforms[result.value.platform] = {
      label: result.value.label,
      count: result.value.items.length,
    };
    items.push(...result.value.items);
  }

  items.sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt));

  const signals = [];
  if (items.length >= 20) {
    signals.push(`CHINA FINANCE WIRE: ${items.length} domestic hot items pulled from finance/trending platforms`);
  }
  if (items.some(item => /伊朗|霍尔木兹|原油|油价|人民币|汇率|关税|制裁/i.test(`${item.title} ${item.content}`))) {
    signals.push('CHINA FINANCE WIRES highlight energy, FX, or sanction stress in domestic coverage');
  }

  return {
    source: 'Hot-News',
    timestamp: new Date().toISOString(),
    platforms,
    items: items.slice(0, 40),
    signals,
  };
}

if (process.argv[1]?.endsWith('hot-news.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}