// China Finance RSS Bridge integration
// Pulls Eastmoney 7×24 快讯 and THS 同花顺 快讯 from a local china-finance-rss server.
// Source: https://github.com/yuxuan-made/china-finance-rss
// Article: https://juejin.cn/post/7607989878777724980
//
// Set CN_FINANCE_RSS_URL in .env to point to your running server (default: http://localhost:8053).
// Feeds consumed:
//   /eastmoney/kuaixun — 东方财富 7×24 快讯
//   /ths/kuaixun       — 同花顺 7×24 快讯
//
// CLS and Xueqiu are intentionally skipped here — they already flow in via hot-news.mjs.

const BASE_URL = process.env.CN_FINANCE_RSS_URL || 'http://localhost:8053';

const FEEDS = [
  { path: '/eastmoney/kuaixun', label: 'Eastmoney Wire', labelZh: '东方财富快讯' },
  { path: '/ths/kuaixun',       label: 'THS Wire',       labelZh: '同花顺快讯' },
];

// ── Minimal RSS 2.0 XML parser (no deps) ─────────────────────────────────────
function extractItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const tag = (name) => {
      const m = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const title = tag('title');
    if (!title) continue;
    items.push({
      title,
      description: tag('description') || title,
      url: tag('link') || null,
      publishedAt: tag('pubDate') || new Date().toISOString(),
    });
  }
  return items;
}

function normalizeTimestamp(value) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

async function fetchFeed(path, label, labelZh) {
  const url = `${BASE_URL.replace(/\/+$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Crucix/2.0', Accept: 'application/rss+xml, application/xml, text/xml' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const raw = extractItems(xml);
    return raw.map(r => ({
      title: r.title,
      content: r.description,
      url: r.url,
      source: label,
      sourceZh: labelZh,
      publishedAt: normalizeTimestamp(r.publishedAt),
    }));
  } catch (err) {
    // Server not running is expected — user may not have started it
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function briefing() {
  const results = await Promise.allSettled(
    FEEDS.map(f => fetchFeed(f.path, f.label, f.labelZh))
  );

  const platforms = {};
  const items = [];

  for (let i = 0; i < FEEDS.length; i++) {
    const r = results[i];
    const feed = FEEDS[i];
    const feedItems = r.status === 'fulfilled' ? r.value : [];
    platforms[feed.path] = { label: feed.label, labelZh: feed.labelZh, count: feedItems.length };
    items.push(...feedItems);
  }

  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const totalCount = items.length;
  const signals = [];
  if (totalCount >= 10) {
    signals.push(`CN-FINANCE-RSS: ${totalCount} wire items from Eastmoney/THS bridge`);
  }
  if (items.some(i => /原油|油价|伊朗|霍尔木兹|人民币|关税|制裁|加息|降息|央行/i.test(`${i.title} ${i.content}`))) {
    signals.push('CN-FINANCE-RSS wires highlight energy, FX, or policy-sensitive keywords');
  }

  return {
    source: 'CN-Finance-RSS',
    timestamp: new Date().toISOString(),
    bridgeUrl: BASE_URL,
    platforms,
    items: items.slice(0, 50),
    total: totalCount,
    signals,
    attribution: {
      repo: 'https://github.com/yuxuan-made/china-finance-rss',
      article: 'https://juejin.cn/post/7607989878777724980',
      license: 'MIT',
    },
  };
}

if (process.argv[1]?.endsWith('cn-finance-rss.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
