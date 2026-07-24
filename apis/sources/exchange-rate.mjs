// 实时汇率数据源 - Exchange Rate API
// 基于开放汇率API: open.er-api.com
const BASE = 'https://open.er-api.com/v6';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// 主要货币对 (基准货币 -> 目标货币)
const TRACKED_PAIRS = [
  { base: 'USD', quote: 'CNY', label: 'USD/CNY' },
  { base: 'EUR', quote: 'CNY', label: 'EUR/CNY' },
  { base: 'GBP', quote: 'CNY', label: 'GBP/CNY' },
  { base: 'JPY', quote: 'CNY', label: 'JPY/CNY' },
  { base: 'HKD', quote: 'CNY', label: 'HKD/CNY' },
  { base: 'USD', quote: 'EUR', label: 'USD/EUR' },
  { base: 'USD', quote: 'JPY', label: 'USD/JPY' },
  { base: 'USD', quote: 'GBP', label: 'USD/GBP' },
];

// 显著波动阈值 (日变化百分比)
const SIGNIFICANT_MOVE_THRESHOLD = 1.0;

async function fetchWithTimeout(url, opts = {}, timeoutMs = 13000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/json', ...opts.headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractRate(data, target) {
  if (!data?.rates) return null;
  const rate = data.rates[target];
  if (rate == null) return null;
  return {
    rate: Number(rate),
    base: data.base_code,
    target,
    lastUpdated: data.time_last_update_utc,
    nextUpdate: data.time_next_update_utc,
  };
}

function buildCrossRate(usdRates, base, quote) {
  // 通过USD作为桥梁货币计算交叉汇率
  if (base === 'USD') {
    return usdRates?.[quote] ?? null;
  }
  if (quote === 'USD') {
    const r = usdRates?.[base];
    return r ? 1 / r : null;
  }
  const baseToUsd = usdRates?.[base];
  const usdToQuote = usdRates?.[quote];
  if (!baseToUsd || !usdToQuote) return null;
  return usdToQuote / baseToUsd;
}

function buildSignals(pairs) {
  const signals = [];
  for (const p of pairs) {
    if (!p?.rate || p.changePct == null) continue;
    const abs = Math.abs(p.changePct);
    if (abs >= SIGNIFICANT_MOVE_THRESHOLD) {
      const direction = p.changePct > 0 ? '升值' : '贬值';
      signals.push({
        type: 'fx_significant_move',
        severity: abs >= 2 ? 'high' : 'medium',
        pair: p.label,
        rate: p.rate,
        changePct: p.changePct,
        direction,
        message: `${p.label} ${direction} ${abs.toFixed(2)}% (rate=${p.rate})`,
      });
    }
  }
  return signals;
}

function computeChangePct(current, previous) {
  if (!previous || !current || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export async function briefing() {
  const timestamp = new Date().toISOString();
  try {
    const [usdData, cnyData] = await Promise.all([
      fetchWithTimeout(`${BASE}/latest/USD`).catch(() => null),
      fetchWithTimeout(`${BASE}/latest/CNY`).catch(() => null),
    ]);

    const usdRates = usdData?.rates || {};
    const pairs = [];

    for (const pair of TRACKED_PAIRS) {
      try {
        let rate = null;
        let lastUpdated = null;

        if (pair.base === 'USD') {
          const r = extractRate(usdData, pair.quote);
          if (r) {
            rate = r.rate;
            lastUpdated = r.lastUpdated;
          }
        } else if (pair.quote === 'CNY') {
          const r = extractRate(usdData, pair.base);
          if (r) {
            rate = r.rate;
            lastUpdated = r.lastUpdated;
          }
        } else {
          const cross = buildCrossRate(usdRates, pair.base, pair.quote);
          if (cross) {
            rate = cross;
            lastUpdated = usdData?.time_last_update_utc;
          }
        }

        if (rate == null) continue;

        pairs.push({
          label: pair.label,
          base: pair.base,
          quote: pair.quote,
          rate,
          lastUpdated,
          changePct: null, // er-api 免费版不提供历史，留空以便后续填充
        });
      } catch (e) {
        // 单个货币对失败，继续处理其他
      }
    }

    // 若有CNY反向数据，可交叉验证 USD/CNY
    const cnyUsdFromCnyBase = cnyData?.rates?.USD;
    if (cnyUsdFromCnyBase) {
      const usdCnyFromUsdBase = usdRates?.CNY;
      if (usdCnyFromUsdBase) {
        const crossCheck = 1 / cnyUsdFromCnyBase;
        const drift = Math.abs(crossCheck - usdCnyFromUsdBase) / usdCnyFromUsdBase;
        if (drift > 0.005) {
          // 超过0.5%偏差,数据可疑
        }
      }
    }

    const signals = buildSignals(pairs);

    return {
      source: 'exchange-rate',
      timestamp,
      base: 'USD',
      pairs,
      raw: {
        usd: usdData ? { base: usdData.base_code, updated: usdData.time_last_update_utc } : null,
        cny: cnyData ? { base: cnyData.base_code, updated: cnyData.time_last_update_utc } : null,
      },
      signals,
      meta: {
        pairsTracked: TRACKED_PAIRS.length,
        pairsResolved: pairs.length,
        signalCount: signals.length,
        provider: 'open.er-api.com',
      },
    };
  } catch (e) {
    return {
      source: 'exchange-rate',
      timestamp,
      error: e.message,
      pairs: [],
      signals: [],
    };
  }
}

export { TRACKED_PAIRS, fetchWithTimeout };
