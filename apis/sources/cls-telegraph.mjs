// Direct CLS Telegraph (财联社电报) scraper
// Fetches realtime telegraph items from cls.cn internal API

const CLS_API_URL = 'https://www.cls.cn/nodeapi/updateTelegraphList';
const CLS_ROLL_URL = 'https://www.cls.cn/v1/roll/get_roll_list';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

function normalizeTimestamp(value) {
  if (!value) return new Date().toISOString();
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function extractSeries(content) {
  const match = String(content || '').match(/^(?:\[([^\]]{1,24})\]|【([^】]{1,24})】)\s*/u);
  if (!match) return { series: null, cleanContent: content };
  return {
    series: (match[1] || match[2] || '').trim() || null,
    cleanContent: String(content || '').slice(match[0].length).trim(),
  };
}

function parseItem(raw) {
  const title = String(raw?.title || raw?.content || raw?.brief || '').trim();
  if (!title || title.length < 6) return null;

  const { series, cleanContent } = extractSeries(title);
  const id = raw?.id || raw?.shareUrl?.match(/\/(\d+)/)?.[1] || '';
  const url = id ? `https://www.cls.cn/detail/${id}` : (raw?.shareUrl || null);

  return {
    title: cleanContent || title,
    content: String(raw?.descSummary || raw?.content || cleanContent || '').trim().slice(0, 300),
    url,
    source: 'CLS Telegraph Direct',
    series,
    publishedAt: normalizeTimestamp(raw?.ctime || raw?.mtime || raw?.modified_time),
    level: raw?.level || 'normal',
    readCount: raw?.readCount || raw?.reading_count || 0,
    commentCount: raw?.commentCount || raw?.comment_count || 0,
  };
}

async function fetchWithTimeout(url, body, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.cls.cn/telegraph',
        'Origin': 'https://www.cls.cn',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function tryNodeApi() {
  const payload = await fetchWithTimeout(CLS_API_URL, { app: 'CailianpressWeb', os: 'web', sv: '8.4.6' });
  const data = payload?.data;
  if (!data) return null;
  const rawItems = Array.isArray(data.roll_data) ? data.roll_data : (Array.isArray(data) ? data : []);
  if (!rawItems.length) return null;
  return rawItems;
}

async function tryRollApi() {
  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    app: 'CailianpressWeb',
    os: 'web',
    sv: '8.4.6',
    rn: '30',
    last_time: String(now),
    categories: '',
  });
  const payload = await fetchWithTimeout(`${CLS_ROLL_URL}?${params}`);
  const rawItems = Array.isArray(payload?.data?.roll_data) ? payload.data.roll_data : [];
  if (!rawItems.length) return null;
  return rawItems;
}

export async function fetchClsTelegraph() {
  let rawItems = null;

  try { rawItems = await tryNodeApi(); } catch {}
  if (!rawItems) {
    try { rawItems = await tryRollApi(); } catch {}
  }

  if (!rawItems || !rawItems.length) {
    return { items: [], source: 'CLS Telegraph Direct', error: 'All CLS API endpoints failed' };
  }

  const items = rawItems
    .map(parseItem)
    .filter(Boolean)
    .slice(0, 40);

  return {
    items,
    source: 'CLS Telegraph Direct',
    count: items.length,
    timestamp: new Date().toISOString(),
  };
}
