// National Vulnerability Database — CVE feed
// No auth required. Tracks newly published CVEs and severity distribution.

import { safeFetch } from '../utils/fetch.mjs';

const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

function getDescription(cve) {
  return cve?.descriptions?.find(d => d.lang === 'en')?.value || '';
}

function getSeverity(cve) {
  const metrics = cve?.metrics || {};
  const entries = metrics.cvssMetricV40 || metrics.cvssMetricV31 || metrics.cvssMetricV30 || metrics.cvssMetricV2 || [];
  const selected = entries[0] || null;
  return {
    severity: selected?.cvssData?.baseSeverity || selected?.baseSeverity || 'UNKNOWN',
    score: selected?.cvssData?.baseScore ?? null,
  };
}

function compactVulnerability(item) {
  const cve = item?.cve || {};
  const summary = getDescription(cve).replace(/\s+/g, ' ').trim();
  const { severity, score } = getSeverity(cve);
  return {
    id: cve.id,
    published: cve.published || null,
    lastModified: cve.lastModified || null,
    severity,
    score,
    summary: summary.substring(0, 220),
    url: cve.id ? `https://nvd.nist.gov/vuln/detail/${cve.id}` : null,
  };
}

function buildParams() {
  const end = new Date();
  const start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  return new URLSearchParams({
    resultsPerPage: '100',
    pubStartDate: start.toISOString(),
    pubEndDate: end.toISOString(),
  });
}

export async function briefing() {
  const data = await safeFetch(`${NVD_URL}?${buildParams()}`, { timeout: 25000 });

  if (data.error) {
    return {
      source: 'NVD',
      timestamp: new Date().toISOString(),
      error: data.error,
    };
  }

  const vulnerabilities = (data.vulnerabilities || []).map(compactVulnerability);
  vulnerabilities.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));

  const summary = vulnerabilities.reduce((acc, vuln) => {
    const key = (vuln.severity || 'UNKNOWN').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { total: vulnerabilities.length, critical: 0, high: 0, medium: 0, low: 0, unknown: 0 });

  const rceCount = vulnerabilities.filter(v => /remote code execution|rce|command injection|arbitrary code/i.test(v.summary)).length;
  const authBypassCount = vulnerabilities.filter(v => /authentication bypass|auth bypass|privilege escalation/i.test(v.summary)).length;

  const signals = [];
  if (summary.critical > 0) signals.push(`NVD CRITICALS: ${summary.critical} newly published critical CVEs in the last 14 days`);
  if (summary.high >= 20) signals.push(`NVD HIGH-SEVERITY LOAD: ${summary.high} new high-severity CVEs in the last 14 days`);
  if (rceCount >= 5) signals.push(`RCE PRESSURE: ${rceCount} recent CVEs mention remote code execution patterns`);
  if (authBypassCount >= 3) signals.push(`ACCESS CONTROL STRESS: ${authBypassCount} recent CVEs mention auth bypass or privilege escalation`);

  return {
    source: 'NVD',
    timestamp: new Date().toISOString(),
    summary: {
      total: summary.total,
      critical: summary.critical,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
      unknown: summary.unknown,
      rceCount,
      authBypassCount,
    },
    vulnerabilities: vulnerabilities.slice(0, 20),
    signals,
  };
}

if (process.argv[1]?.endsWith('nvd.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}