// Spaceflight News API — Space industry and launch reporting
// No auth required. Complements orbital telemetry with editorial context.

import { safeFetch } from '../utils/fetch.mjs';

const NEWS_URL = 'https://api.spaceflightnewsapi.net/v4/articles/?limit=15';

function compactArticle(article) {
  return {
    id: article?.id || null,
    title: article?.title || 'Untitled',
    source: article?.news_site || 'Spaceflight News',
    publishedAt: article?.published_at || null,
    updatedAt: article?.updated_at || null,
    summary: (article?.summary || '').replace(/\s+/g, ' ').trim().substring(0, 240),
    url: article?.url || null,
  };
}

export async function briefing() {
  const data = await safeFetch(NEWS_URL, { timeout: 20000 });

  if (data.error) {
    return {
      source: 'Spaceflight News',
      timestamp: new Date().toISOString(),
      error: data.error,
    };
  }

  const articles = (data.results || []).map(compactArticle);
  const bySite = {};
  for (const article of articles) {
    bySite[article.source] = (bySite[article.source] || 0) + 1;
  }

  const keywordCount = (pattern) => articles.filter(article => pattern.test(article.title)).length;
  const signals = [];
  const lunarStories = keywordCount(/artemis|moon|lunar/i);
  const launchStories = keywordCount(/launch|rocket|starship|falcon|electron/i);
  const militaryStories = keywordCount(/missile|military|defense|surveillance/i);
  if (lunarStories >= 2) signals.push(`LUNAR CYCLE ACTIVE: ${lunarStories} recent space headlines reference lunar missions`);
  if (launchStories >= 4) signals.push(`SPACE OPS TEMPO: ${launchStories} recent space headlines reference launch activity`);
  if (militaryStories > 0) signals.push(`MILITARY SPACE SIGNAL: ${militaryStories} recent space headlines reference defense or surveillance programs`);

  return {
    source: 'Spaceflight News',
    timestamp: new Date().toISOString(),
    totalArticles: articles.length,
    bySite,
    articles,
    signals,
  };
}

if (process.argv[1]?.endsWith('spaceflight-news.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}