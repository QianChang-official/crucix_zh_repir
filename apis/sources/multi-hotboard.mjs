// 全平台热搜聚合数据源
// 使用 uapis.cn/api/hotboard 聚合 baidu/weibo/zhihu/douyin/bilibili/toutiao 六大平台
// 并行抓取 → 标准化 → 跨平台去重(标题相似度) → 跨平台共振信号
// 信号: 3+ 平台同时热搜的话题 = 跨平台共振(高优先级情报)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const BASE = 'https://api.uapis.cn/api/hotboard';

const PLATFORMS = [
  { type: 'baidu', label: '百度' },
  { type: 'weibo', label: '微博' },
  { type: 'zhihu', label: '知乎' },
  { type: 'douyin', label: '抖音' },
  { type: 'bilibili', label: '哔哩哔哩' },
  { type: 'toutiao', label: '今日头条' },
];

async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json,text/plain,*/*',
        'Referer': 'https://api.uapis.cn/',
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { rawText: text.slice(0, 500) };
    }
  } finally {
    clearTimeout(timer);
  }
}

function parseItems(payload, platform) {
  if (!payload) return [];
  const list =
    payload.data?.list ||
    payload.data?.items ||
    payload.data ||
    payload.list ||
    payload.items ||
    [];
  if (!Array.isArray(list)) return [];

  return list
    .map((entry, idx) => {
      if (!entry || typeof entry !== 'object') return null;
      const title = String(
        entry.title || entry.name || entry.word || entry.query || ''
      ).trim();
      if (!title) return null;
      return {
        title,
        platform,
        hot: Number(entry.hot || entry.hotScore || entry.score || entry.heat || 0) || 0,
        url: String(entry.url || entry.link || entry.redirect_url || '').trim() || null,
        rank: Number(entry.rank || idx + 1) || idx + 1,
      };
    })
    .filter(Boolean);
}

// 简易标题归一化: 去除标点/空格/常见后缀,用于跨平台去重
function normalizeTitle(title) {
  return String(title || '')
    .replace(/[\s\u0000-\u001F\u3000]+/g, '')
    .replace(/[【】\[\]()（）{}""''「」『』《》<>·\-_,.!?:;'"\\\/|~`@#$%^&*+=]/g, '')
    .toLowerCase()
    .slice(0, 60);
}

// 标题相似度: 归一化后包含关系或 Jaccard 字符集相似度 >= 0.6
function isSimilar(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 6 && nb.includes(na)) return true;
  if (nb.length >= 6 && na.includes(nb)) return true;
  // 字符集 Jaccard
  const sa = new Set(na);
  const sb = new Set(nb);
  let inter = 0;
  for (const c of sa) if (sb.has(c)) inter++;
  const union = sa.size + sb.size - inter;
  return union > 0 && inter / union >= 0.6;
}

async function fetchPlatform(platform) {
  try {
    const payload = await fetchWithTimeout(`${BASE}?type=${platform.type}`);
    const items = parseItems(payload, platform.type);
    return { platform: platform.type, label: platform.label, items, ok: true };
  } catch (e) {
    return {
      platform: platform.type,
      label: platform.label,
      items: [],
      ok: false,
      error: e.message,
    };
  }
}

function aggregateAndDedupe(platformResults) {
  // 把所有条目摊平
  const all = [];
  for (const p of platformResults) {
    for (const item of p.items) {
      all.push({ ...item, label: p.label });
    }
  }

  // 按相似度聚类
  const clusters = []; // { representative, platforms: Set, items: [] }
  for (const item of all) {
    let matched = null;
    for (const c of clusters) {
      if (isSimilar(item.title, c.representative)) {
        matched = c;
        break;
      }
    }
    if (matched) {
      matched.items.push(item);
      if (!matched.platforms.has(item.platform)) {
        matched.platforms.add(item.platform);
      }
    } else {
      clusters.push({
        representative: item.title,
        platforms: new Set([item.platform]),
        items: [item],
      });
    }
  }

  // 生成聚合条目
  const aggregated = clusters
    .map((c) => {
      const platforms = [...c.platforms];
      const topItem = c.items.reduce((a, b) => (b.hot > a.hot ? b : a));
      return {
        title: topItem.title,
        platforms,
        platformCount: platforms.length,
        platformLabels: platforms.map(
          (p) => PLATFORMS.find((x) => x.type === p)?.label || p
        ),
        maxHot: topItem.hot,
        totalHot: c.items.reduce((s, i) => s + i.hot, 0),
        url: topItem.url,
        occurrences: c.items.length,
      };
    })
    .sort((a, b) => b.platformCount - a.platformCount || b.maxHot - a.maxHot);

  return aggregated;
}

function buildSignals(aggregated, platformResults) {
  const signals = [];

  // 平台可用性
  const okPlatforms = platformResults.filter((p) => p.ok);
  const failedPlatforms = platformResults.filter((p) => !p.ok);
  signals.push(
    `MULTI-HOTBOARD COVERAGE: ${okPlatforms.length}/${PLATFORMS.length} 平台在线` +
      (failedPlatforms.length
        ? ` (失败: ${failedPlatforms.map((p) => p.label).join('/')})`
        : '')
  );

  // 跨平台共振: 3+ 平台同时热搜
  const resonance = aggregated.filter((a) => a.platformCount >= 3);
  if (resonance.length) {
    signals.push(
      `CROSS-PLATFORM RESONANCE (${resonance.length} topics on 3+ platforms): ` +
        resonance
          .slice(0, 5)
          .map((a) => `「${a.title}」(${a.platformCount}平台)`)
          .join(' | ')
    );
  }

  // 全平台共振: 6 平台全部热搜
  const fullResonance = aggregated.filter((a) => a.platformCount >= PLATFORMS.length);
  if (fullResonance.length) {
    signals.push(
      `FULL-SPECTRUM RESONANCE (all ${PLATFORMS.length} platforms): ` +
        fullResonance.map((a) => `「${a.title}」`).join(' | ')
    );
  }

  // 财经/地缘相关共振
  const financeResonance = resonance.filter((a) =>
    /股票|A股|港股|美股|基金|期货|原油|油价|黄金|汇率|人民币|美元|制裁|关税|贸易|地产|楼市|通胀|降息|加息|GDP|CPI|PMI/i.test(
      a.title
    )
  );
  if (financeResonance.length) {
    signals.push(
      `FINANCE CROSS-PLATFORM: ${financeResonance.length} 个财经话题跨平台共振 — ` +
        financeResonance.map((a) => `「${a.title}」(${a.platformCount}平台)`).join(' | ')
    );
  }

  return signals;
}

export async function briefing() {
  const timestamp = new Date().toISOString();
  try {
    // 六大平台并行抓取
    const platformResults = await Promise.all(PLATFORMS.map(fetchPlatform));

    const aggregated = aggregateAndDedupe(platformResults);
    const signals = buildSignals(aggregated, platformResults);

    const totalItems = platformResults.reduce((s, p) => s + p.items.length, 0);
    const platformSummary = {};
    for (const p of platformResults) {
      platformSummary[p.platform] = {
        label: p.label,
        count: p.items.length,
        ok: p.ok,
        ...(p.error ? { error: p.error } : {}),
      };
    }

    return {
      source: 'Multi-Hotboard',
      timestamp,
      endpoint: BASE,
      platforms: platformSummary,
      totalItems,
      dedupedTopics: aggregated.length,
      resonanceCount: aggregated.filter((a) => a.platformCount >= 3).length,
      items: aggregated.slice(0, 30),
      signals,
      meta: {
        platformCount: PLATFORMS.length,
        onlinePlatforms: platformResults.filter((p) => p.ok).length,
        topTopic: aggregated[0]?.title || null,
        topTopicPlatforms: aggregated[0]?.platformCount || 0,
      },
    };
  } catch (e) {
    return {
      source: 'Multi-Hotboard',
      timestamp,
      error: e.message,
      items: [],
      signals: [`MULTI-HOTBOARD FETCH FAILED: ${e.message}`],
    };
  }
}

if (process.argv[1]?.endsWith('multi-hotboard.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
