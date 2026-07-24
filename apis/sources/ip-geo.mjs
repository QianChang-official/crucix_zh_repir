// Tmini.net IP Info API (apidoc id=5) — IP geolocation & risk intelligence
// Endpoint: https://tmini.net/api/ipinfo?ip={ip}
// Provides: IP归属地 / 运营商 / 经纬度 / 时区 / 邮编 / 代理检测 / 风险等级
// No auth required. Browser UA needed.
//
// Probes a set of well-known public DNS resolvers to build a threat-intelligence
// picture across international + Chinese infrastructure. Requests run with bounded
// concurrency to respect tmini's QPS limit; failures are isolated per-IP and
// never abort the briefing.

const BASE = 'https://tmini.net/api/ipinfo';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
// Referer + browser UA reduce the chance of triggering tmini's anti-bot guard (HTTP 456).
// The platform enforces QPS≈5, so we also cap concurrency and stagger requests.
const HEADERS = {
  'User-Agent': UA,
  Referer: 'https://www.tmini.net/',
  Accept: 'application/json,text/plain,*/*',
};

// Run async map with bounded concurrency + stagger to stay under the QPS limit.
async function mapWithConcurrency(items, limit, staggerMs, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      if (staggerMs > 0) await new Promise(r => setTimeout(r, staggerMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Probe targets — mix of international + Chinese public resolvers
const PROBE_IPS = [
  { ip: '8.8.8.8',         label: 'Google DNS' },
  { ip: '1.1.1.1',         label: 'Cloudflare DNS' },
  { ip: '114.114.114.114', label: '114DNS (CN)' },
  { ip: '208.67.222.222',  label: 'OpenDNS' },
  { ip: '9.9.9.9',         label: 'Quad9' },
  { ip: '223.5.5.5',       label: 'AliDNS (CN)' },
  { ip: '119.29.29.29',    label: 'DNSPod (CN)' },
];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctToNumber(value) {
  // "0%" / "17%" → 0 / 17
  if (value == null) return null;
  const n = Number(String(value).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

function isProxyFlagged(risk) {
  if (!risk) return false;
  if (risk.isProxy === '是' || /^(true|yes)$/i.test(String(risk.isProxy))) return true;
  if ((risk.proxyProbability ?? -1) >= 50) return true;
  if (risk.proxyType && String(risk.proxyType).trim()) return true;
  return false;
}

function isHighRisk(risk) {
  if (!risk) return false;
  if (/高|危险/.test(risk.riskLevel || '') && !/无风险/.test(risk.riskLevel || '')) return true;
  if ((risk.riskScore ?? -1) >= 70) return true;
  return false;
}

function normalizeRecord(payload, probe) {
  if (!payload || payload.status !== 1 || !payload.data) {
    return { ip: probe.ip, label: probe.label, error: payload?.message || 'no data' };
  }
  const d = payload.data;
  const r = d.risk || {};
  return {
    ip: d.ip || probe.ip,
    label: probe.label,
    country: d.country || null,
    countryCode: d.country_code || null,
    province: d.province || null,
    city: d.city || null,
    district: d.district || null,
    continent: d.continent || null,
    isp: d.isp || null,
    latitude: toNumber(d.latitude),
    longitude: toNumber(d.longitude),
    timeZone: d.time_zone || null,
    zipCode: d.zip_code || null,
    ipInt: toNumber(d.ip_int),
    location: d.location || null,
    risk: {
      isProxy: r.is_proxy ?? null,
      proxyProbability: pctToNumber(r.proxy_probability),
      proxyType: r.proxy_type || null,
      riskLevel: r.risk_level || null,
      riskScore: toNumber(r.risk_score),
      riskTag: r.risk_tag || null,
      realRate: pctToNumber(r.real),
      mbRate: pctToNumber(r.mb_rate),
    },
  };
}

async function fetchIp(probe) {
  const url = `${BASE}?ip=${encodeURIComponent(probe.ip)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return normalizeRecord(payload, probe);
  } catch (e) {
    return { ip: probe.ip, label: probe.label, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function buildSignals(records) {
  const signals = [];
  const ok = records.filter(r => r && !r.error);

  // Per-IP proxy / high-risk flags
  for (const r of ok) {
    if (isProxyFlagged(r.risk)) {
      signals.push(`IP PROXY DETECTED: ${r.ip} (${r.label}) — ${r.country} / ${r.isp} | proxy prob ${r.risk?.proxyProbability ?? '?'}% | tag ${r.risk?.riskTag || r.risk?.proxyType || 'n/a'}`);
    }
    if (isHighRisk(r.risk)) {
      signals.push(`IP HIGH RISK: ${r.ip} (${r.label}) — level ${r.risk?.riskLevel} | score ${r.risk?.riskScore} | tag ${r.risk?.riskTag || 'n/a'}`);
    }
  }

  // Aggregate threat picture
  const probed = ok.length;
  const proxyCount = ok.filter(r => isProxyFlagged(r.risk)).length;
  const highRiskCount = ok.filter(r => isHighRisk(r.risk)).length;
  const cnCount = ok.filter(r => r.countryCode === 'CN' || /中国|大陆/.test(r.country || '')).length;
  const intlCount = probed - cnCount;

  if (probed) {
    signals.push(`IP THREAT PICTURE: ${probed} resolvers probed — ${proxyCount} proxy-flagged, ${highRiskCount} high-risk (${cnCount} CN / ${intlCount} intl)`);
  }

  return signals;
}

export async function briefing() {
  // Concurrency 2 + 250ms stagger keeps us safely under tmini's QPS≈5 and avoids the 456 anti-bot guard.
  const records = await mapWithConcurrency(PROBE_IPS, 2, 250, fetchIp);

  const ok = records.filter(r => !r.error);
  const failed = records.length - ok.length;
  const signals = buildSignals(records);

  const summary = {
    probed: PROBE_IPS.length,
    ok: ok.length,
    failed,
    proxyDetected: ok.filter(r => isProxyFlagged(r.risk)).length,
    highRisk: ok.filter(r => isHighRisk(r.risk)).length,
    countries: [...new Set(ok.map(r => r.country).filter(Boolean))],
    isps: [...new Set(ok.map(r => r.isp).filter(Boolean))],
  };

  return {
    source: 'IP-Geo',
    timestamp: new Date().toISOString(),
    endpoint: BASE,
    records,
    summary,
    signals,
  };
}

if (process.argv[1]?.endsWith('ip-geo.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
