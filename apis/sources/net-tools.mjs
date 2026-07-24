// Crucix Intelligence Engine - Network Reconnaissance Tools Data Source
// 网络侦察工具集数据源 - 使用 uapis.cn 进行网络诊断

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal, headers: { 'User-Agent': UA, ...opts.headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { rawText: text.slice(0, 500) }; }
  } finally { clearTimeout(timer); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PING_TARGETS = ['baidu.com', 'google.com', 'github.com'];
const DNS_TARGETS = [
  { domain: 'baidu.com', type: 'A' },
  { domain: 'tencent.com', type: 'A' },
  { domain: 'alibaba.com', type: 'A' }
];
const PORT_TARGETS = [
  { host: 'baidu.com', port: 80 },
  { host: 'baidu.com', port: 443 }
];

async function runPing(host) {
  try {
    const data = await fetchWithTimeout(`https://api.uapis.cn/api/ping?host=${encodeURIComponent(host)}`);
    return { host, ok: true, data };
  } catch (e) {
    return { host, ok: false, error: e.message };
  }
}

async function runDNS(domain, type = 'A') {
  try {
    const data = await fetchWithTimeout(`https://api.uapis.cn/api/dns?domain=${encodeURIComponent(domain)}&type=${type}`);
    return { domain, type, ok: true, data };
  } catch (e) {
    return { domain, type, ok: false, error: e.message };
  }
}

async function runPortScan(host, port) {
  try {
    const data = await fetchWithTimeout(`https://api.uapis.cn/api/port?host=${encodeURIComponent(host)}&port=${port}`);
    return { host, port, ok: true, data };
  } catch (e) {
    return { host, port, ok: false, error: e.message };
  }
}

function analyzeSignals(pingResults, dnsResults, portResults) {
  const signals = [];

  // 不可达主机
  for (const p of pingResults) {
    if (!p.ok) {
      signals.push({ type: 'ping_unreachable', severity: 'medium', target: p.host, message: `Ping 失败: ${p.error}` });
    } else if (p.data && typeof p.data === 'object') {
      const raw = p.data.rawText || JSON.stringify(p.data);
      if (/timeout|超时|unreachable|无法/i.test(raw)) {
        signals.push({ type: 'ping_timeout', severity: 'medium', target: p.host, message: `Ping 超时或不可达` });
      }
    }
  }

  // DNS 异常响应
  for (const d of dnsResults) {
    if (!d.ok) {
      signals.push({ type: 'dns_query_failed', severity: 'high', target: d.domain, message: `DNS 查询失败: ${d.error}` });
    } else if (d.data && typeof d.data === 'object') {
      const raw = d.data.rawText || JSON.stringify(d.data);
      if (/error|fail|无效|错误/i.test(raw) && !/A\|/.test(raw)) {
        signals.push({ type: 'dns_unusual_response', severity: 'medium', target: d.domain, message: `DNS 响应异常` });
      }
    }
  }

  // 开放端口
  for (const p of portResults) {
    if (p.ok && p.data && typeof p.data === 'object') {
      const raw = p.data.rawText || JSON.stringify(p.data);
      if (/open|开放|1\b/.test(raw) && !/close|关闭/.test(raw)) {
        signals.push({ type: 'port_open', severity: 'info', target: `${p.host}:${p.port}`, message: `端口开放` });
      } else if (/close|关闭|filtered/.test(raw)) {
        signals.push({ type: 'port_closed', severity: 'info', target: `${p.host}:${p.port}`, message: `端口关闭或过滤` });
      }
    } else if (!p.ok) {
      signals.push({ type: 'port_scan_failed', severity: 'low', target: `${p.host}:${p.port}`, message: `端口扫描失败: ${p.error}` });
    }
  }

  return signals;
}

export async function briefing() {
  try {
    const [pingResults, dnsResults, portResults] = await Promise.all([
      Promise.all(PING_TARGETS.map(h => runPing(h).then(r => { return r; }).then(async (r) => { await sleep(200); return r; }))),
      Promise.all(DNS_TARGETS.map(d => runDNS(d.domain, d.type).then(async (r) => { await sleep(200); return r; }))),
      Promise.all(PORT_TARGETS.map(p => runPortScan(p.host, p.port).then(async (r) => { await sleep(200); return r; })))
    ]);

    const signals = analyzeSignals(pingResults, dnsResults, portResults);

    return {
      source: 'net-tools',
      timestamp: new Date().toISOString(),
      data: {
        ping: pingResults,
        dns: dnsResults,
        portScan: portResults,
        summary: {
          totalPing: pingResults.length,
          reachable: pingResults.filter(p => p.ok).length,
          unreachable: pingResults.filter(p => !p.ok).length,
          totalDns: dnsResults.length,
          dnsOk: dnsResults.filter(d => d.ok).length,
          totalPort: portResults.length,
          portScanOk: portResults.filter(p => p.ok).length
        }
      },
      signals
    };
  } catch (e) {
    return { source: 'net-tools', timestamp: new Date().toISOString(), error: e.message, signals: [] };
  }
}

if (process.argv[1]?.endsWith('net-tools.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
