// Crucix Intelligence Engine - GitHub Intelligence Monitor
// GitHub情报监控数据源 - 监控热门新仓库和安全公告

const UA = 'Crucix-Intel/2.1';

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/vnd.github+json',
        ...opts.headers
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { rawText: text.slice(0, 500) }; }
  } finally { clearTimeout(timer); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchTrendingRepos() {
  try {
    const since = '2026-07-01';
    const url = `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=10`;
    const data = await fetchWithTimeout(url);
    if (!data || !data.items) return { ok: false, error: 'No items in response', items: [] };
    const items = data.items.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      language: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      topics: repo.topics || [],
      url: repo.html_url,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
      open_issues: repo.open_issues_count,
      license: repo.license?.name
    }));
    return { ok: true, total_count: data.total_count, items };
  } catch (e) {
    return { ok: false, error: e.message, items: [] };
  }
}

async function fetchSecurityAdvisories() {
  try {
    const url = 'https://api.github.com/advisories?per_page=10';
    const data = await fetchWithTimeout(url);
    if (!Array.isArray(data)) return { ok: false, error: 'Unexpected response format', items: [] };
    const items = data.map(adv => ({
      id: adv.ghsa_id,
      summary: adv.summary,
      severity: adv.severity,
      cve_id: adv.cve_id,
      published_at: adv.published_at,
      updated_at: adv.updated_at,
      withdrawn_at: adv.withdrawn_at,
      url: adv.html_url,
      affected: (adv.vulnerabilities || []).map(v => ({
        package: v.package?.name,
        ecosystem: v.package?.ecosystem,
        vulnerable_version_range: v.vulnerable_version_range,
        patched_version: v.first_patched_version?.identifier
      })),
      cwe: adv.cwes?.map(c => c.cwe_id) || [],
      references: (adv.references || []).slice(0, 3).map(r => r.url)
    }));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: e.message, items: [] };
  }
}

function analyzeSignals(trending, advisories) {
  const signals = [];

  // 高星新仓库
  if (trending.ok) {
    for (const repo of trending.items) {
      if (repo.stars > 1000) {
        signals.push({
          type: 'high_star_new_repo',
          severity: 'info',
          target: repo.full_name,
          message: `新仓库高星: ${repo.stars} stars - ${repo.description?.slice(0, 60) || 'no description'}`,
          stars: repo.stars,
          language: repo.language
        });
      }
    }
    if (trending.items.length === 0) {
      signals.push({ type: 'no_trending_repos', severity: 'low', message: '未获取到热门仓库数据' });
    }
  } else {
    signals.push({ type: 'trending_fetch_failed', severity: 'medium', message: `热门仓库获取失败: ${trending.error}` });
  }

  // 关键安全公告
  if (advisories.ok) {
    for (const adv of advisories.items) {
      if (adv.severity === 'critical') {
        signals.push({
          type: 'critical_advisory',
          severity: 'critical',
          target: adv.cve_id || adv.id,
          message: `严重安全公告: ${adv.summary}`,
          cve: adv.cve_id,
          affected_packages: adv.affected.map(a => a.package).filter(Boolean)
        });
      } else if (adv.severity === 'high') {
        signals.push({
          type: 'high_advisory',
          severity: 'high',
          target: adv.cve_id || adv.id,
          message: `高危安全公告: ${adv.summary}`,
          cve: adv.cve_id
        });
      }
    }
    if (advisories.items.length === 0) {
      signals.push({ type: 'no_advisories', severity: 'low', message: '未获取到安全公告数据' });
    }
  } else {
    signals.push({ type: 'advisories_fetch_failed', severity: 'medium', message: `安全公告获取失败: ${advisories.error}` });
  }

  // 速率限制检查
  if (trending.error?.includes('403') || advisories.error?.includes('403')) {
    signals.push({
      type: 'github_rate_limit',
      severity: 'high',
      message: 'GitHub API 可能触发速率限制,建议添加认证 token'
    });
  }

  return signals;
}

export async function briefing() {
  try {
    const [trending, advisories] = await Promise.all([
      fetchTrendingRepos(),
      fetchSecurityAdvisories()
    ]);

    const signals = analyzeSignals(trending, advisories);

    return {
      source: 'github-intel',
      timestamp: new Date().toISOString(),
      data: {
        trending,
        securityAdvisories: advisories,
        summary: {
          trendingCount: trending.items?.length || 0,
          advisoriesCount: advisories.items?.length || 0,
          criticalAdvisories: advisories.items?.filter(a => a.severity === 'critical').length || 0,
          highStarRepos: trending.items?.filter(r => r.stars > 1000).length || 0
        }
      },
      signals
    };
  } catch (e) {
    return { source: 'github-intel', timestamp: new Date().toISOString(), error: e.message, signals: [] };
  }
}

if (process.argv[1]?.endsWith('github-intel.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
