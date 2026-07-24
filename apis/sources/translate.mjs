// 翻译能力数据源 - 翻译外电标题为中文
// 使用 uapis.cn/api/translate (POST) 翻译英文 OSINT 标题
// 同时导出工具函数 translate(text, from, to) 供其他模块调用
// briefing() 测试 API 可用性,返回状态 + 示例翻译结果

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const BASE = 'https://api.uapis.cn/api/translate';

// 支持的语言代码
const SUPPORTED_LANGS = new Set([
  'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'ar', 'pt', 'it', 'th', 'vi',
]);

// 测试用例 —— 模拟当前 OSINT 订阅源中常见的英文标题
const TEST_PHRASES = [
  { text: 'Federal Reserve holds interest rates steady amid inflation concerns', from: 'en', to: 'zh' },
  { text: 'Oil prices surge as OPEC+ extends production cuts', from: 'en', to: 'zh' },
  { text: 'US imposes new sanctions on technology exports', from: 'en', to: 'zh' },
];

async function fetchWithTimeout(url, opts = {}, timeoutMs = 14000) {
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

/**
 * 翻译文本
 * @param {string} text - 待翻译文本
 * @param {string} from - 源语言代码 (en/zh/ja/...)
 * @param {string} to - 目标语言代码
 * @returns {Promise<{ok: boolean, from: string, to: string, original: string, translated: string|null, error?: string}>}
 */
export async function translate(text, from = 'en', to = 'zh') {
  if (!text || typeof text !== 'string') {
    return { ok: false, from, to, original: text, translated: null, error: 'empty input' };
  }
  if (!SUPPORTED_LANGS.has(from)) {
    return { ok: false, from, to, original: text, translated: null, error: `unsupported from: ${from}` };
  }
  if (!SUPPORTED_LANGS.has(to)) {
    return { ok: false, from, to, original: text, translated: null, error: `unsupported to: ${to}` };
  }
  if (from === to) {
    return { ok: true, from, to, original: text, translated: text };
  }

  try {
    const payload = await fetchWithTimeout(BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, from, to }),
    });

    const translated =
      payload?.data?.text ||
      payload?.data?.translated ||
      payload?.data?.result ||
      payload?.text ||
      payload?.translated ||
      payload?.result ||
      payload?.data ||
      null;

    if (!translated) {
      return {
        ok: false,
        from,
        to,
        original: text,
        translated: null,
        error: payload?.msg || payload?.message || 'no translation in response',
        apiCode: payload?.code ?? null,
      };
    }

    return {
      ok: true,
      from,
      to,
      original: text,
      translated: String(translated),
    };
  } catch (e) {
    return {
      ok: false,
      from,
      to,
      original: text,
      translated: null,
      error: e.message,
    };
  }
}

function buildSignals(testResults) {
  const signals = [];

  const ok = testResults.filter((r) => r.ok);
  const failed = testResults.filter((r) => !r.ok);

  if (ok.length === 0) {
    signals.push('TRANSLATE API OFFLINE: 所有测试翻译失败,翻译能力不可用');
    return signals;
  }

  signals.push(
    `TRANSLATE API STATUS: ${ok.length}/${testResults.length} 测试翻译成功,翻译能力可用`
  );

  if (failed.length > 0) {
    signals.push(
      `TRANSLATE PARTIAL FAILURE: ${failed.length} 条翻译失败 — ${failed
        .map((r) => r.error)
        .slice(0, 2)
        .join(' | ')}`
    );
  }

  // 输出前几条成功翻译的摘要
  if (ok.length) {
    const samples = ok
      .slice(0, 2)
      .map((r) => `"${r.original.slice(0, 40)}..." → "${r.translated.slice(0, 40)}..."`)
      .join(' | ');
    signals.push(`TRANSLATE SAMPLES: ${samples}`);
  }

  return signals;
}

export async function briefing() {
  const timestamp = new Date().toISOString();
  try {
    // 并行翻译所有测试短语
    const testResults = await Promise.all(
      TEST_PHRASES.map((p) => translate(p.text, p.from, p.to))
    );

    const signals = buildSignals(testResults);
    const ok = testResults.filter((r) => r.ok);

    return {
      source: 'Translate',
      timestamp,
      endpoint: BASE,
      capability: 'en→zh translation for OSINT headlines',
      apiAvailable: ok.length > 0,
      successRate: `${ok.length}/${testResults.length}`,
      supportedLangs: [...SUPPORTED_LANGS],
      items: testResults.map((r, i) => ({
        ...TEST_PHRASES[i],
        ...r,
        original: TEST_PHRASES[i].text,
      })),
      signals,
      meta: {
        method: 'POST',
        contentType: 'application/json',
        bodyFormat: '{ text, from, to }',
        testPhraseCount: TEST_PHRASES.length,
        okCount: ok.length,
      },
    };
  } catch (e) {
    return {
      source: 'Translate',
      timestamp,
      error: e.message,
      apiAvailable: false,
      items: [],
      signals: [`TRANSLATE BRIEFING FAILED: ${e.message}`],
    };
  }
}

if (process.argv[1]?.endsWith('translate.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
