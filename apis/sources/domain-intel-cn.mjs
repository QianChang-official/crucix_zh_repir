// 中国域名情报数据源 - ICP/WHOIS/微信拦截状态
// 多源聚合: uapis.cn (ICP/WHOIS), tmini.net (微信拦截)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const ICP_API = 'https://api.uapis.cn/api/icp';
const WHOIS_API = 'https://api.uapis.cn/api/whois';
const WECHAT_BLOCK_API = 'https://www.tmini.net/apidata';

// 关注的中国互联网主要域名
const WATCH_DOMAINS = [
  'baidu.com',
  'tencent.com',
  'alibaba.com',
  'sina.com.cn',
  'jd.com',
  'bytedance.com',
  'netease.com',
  'meituan.com',
];

const REQUEST_DELAY_MS = 350; // 防止限流的请求间隔

async function fetchWithTimeout(url, opts = {}, timeoutMs = 14000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': 'https://www.google.com/',
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return await res.json();
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseIcp(data) {
  if (!data) return null;
  const payload = data.data || data;
  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0];
    return {
      icpNumber: first.icp || first.icpNo || first.number,
      companyName: first.unitName || first.name || first.company,
      nature: first.natureName || first.nature,
      siteLicense: first.siteLicense || first.siteIndex,
      updated: first.updateTime || first.updated,
    };
  }
  if (typeof payload === 'object') {
    return {
      icpNumber: payload.icp || payload.icpNo || payload.number,
      companyName: payload.unitName || payload.name || payload.company,
      nature: payload.natureName || payload.nature,
      siteLicense: payload.siteLicense || payload.siteIndex,
      updated: payload.updateTime || payload.updated,
    };
  }
  return null;
}

function parseWhois(data) {
  if (!data) return null;
  const payload = data.data || data;
  if (typeof payload === 'string') {
    return { raw: payload.slice(0, 2000) };
  }
  return {
    registrar: payload.registrar || payload.sponsoringRegistrar,
    creationDate: payload.creationDate || payload.creation_time,
    expirationDate: payload.expirationDate || payload.expiry_date || payload.registryExpiryDate,
    updatedDate: payload.updatedDate || payload.updated_date,
    nameServers: payload.nameServers || payload.name_server,
    status: payload.status,
    raw: payload.raw ? String(payload.raw).slice(0, 1500) : undefined,
  };
}

function parseWechatBlock(data) {
  if (!data) return null;
  const payload = data.data || data;
  // tmini.net 返回字段: status, type, msg
  // type: 1=正常, 2=已拦截
  const blocked = payload?.type === 2 || payload?.status === 'blocked' || payload?.blocked === true;
  return {
    blocked,
    type: payload?.type,
    message: payload?.msg || payload?.message,
    checkedAt: payload?.time || payload?.checkedAt,
  };
}

async function queryIcp(domain) {
  try {
    const data = await fetchWithTimeout(`${ICP_API}?domain=${encodeURIComponent(domain)}`);
    return parseIcp(data);
  } catch (e) {
    return { error: e.message };
  }
}

async function queryWhois(domain) {
  try {
    const data = await fetchWithTimeout(`${WHOIS_API}?domain=${encodeURIComponent(domain)}`);
    return parseWhois(data);
  } catch (e) {
    return { error: e.message };
  }
}

async function queryWechatBlock(domain) {
  try {
    const data = await fetchWithTimeout(
      `${WECHAT_BLOCK_API}?id=13&domain=${encodeURIComponent(domain)}`
    );
    return parseWechatBlock(data);
  } catch (e) {
    return { error: e.message };
  }
}

function buildSignals(domainIntels) {
  const signals = [];
  for (const d of domainIntels) {
    if (!d) continue;

    // 微信拦截
    if (d.wechat?.blocked) {
      signals.push({
        type: 'wechat_blocked',
        severity: 'high',
        domain: d.domain,
        message: `${d.domain} 在微信中被拦截: ${d.wechat.message || 'blocked'}`,
      });
    }

    // ICP 失效或缺失
    if (d.icp?.error) {
      signals.push({
        type: 'icp_query_failed',
        severity: 'low',
        domain: d.domain,
        message: `${d.domain} ICP查询失败: ${d.icp.error}`,
      });
    } else if (!d.icp?.icpNumber) {
      signals.push({
        type: 'icp_missing',
        severity: 'medium',
        domain: d.domain,
        message: `${d.domain} 未查询到ICP备案信息`,
      });
    }

    // WHOIS 即将过期 (30天内)
    if (d.whois?.expirationDate) {
      try {
        const exp = new Date(d.whois.expirationDate);
        const daysLeft = Math.floor((exp - Date.now()) / 86400000);
        if (daysLeft >= 0 && daysLeft <= 30) {
          signals.push({
            type: 'domain_expiring_soon',
            severity: 'medium',
            domain: d.domain,
            daysLeft,
            expirationDate: d.whois.expirationDate,
            message: `${d.domain} 将在 ${daysLeft} 天后过期 (${d.whois.expirationDate})`,
          });
        } else if (daysLeft < 0) {
          signals.push({
            type: 'domain_expired',
            severity: 'high',
            domain: d.domain,
            expirationDate: d.whois.expirationDate,
            message: `${d.domain} 已过期 (${d.whois.expirationDate})`,
          });
        }
      } catch {
        // 日期解析失败,忽略
      }
    }
  }
  return signals;
}

async function collectDomainIntel(domain) {
  // 串行+延迟,避免限流
  const icp = await queryIcp(domain);
  await sleep(REQUEST_DELAY_MS);
  const whois = await queryWhois(domain);
  await sleep(REQUEST_DELAY_MS);
  const wechat = await queryWechatBlock(domain);
  await sleep(REQUEST_DELAY_MS);

  return {
    domain,
    icp,
    whois,
    wechat,
    collectedAt: new Date().toISOString(),
  };
}

export async function briefing() {
  const timestamp = new Date().toISOString();
  try {
    const domainIntels = [];
    // 串行处理以避免限流
    for (const domain of WATCH_DOMAINS) {
      try {
        const intel = await collectDomainIntel(domain);
        domainIntels.push(intel);
      } catch (e) {
        domainIntels.push({
          domain,
          error: e.message,
          collectedAt: new Date().toISOString(),
        });
      }
    }

    const signals = buildSignals(domainIntels);

    return {
      source: 'domain-intel-cn',
      timestamp,
      items: domainIntels,
      signals,
      meta: {
        domainsWatched: WATCH_DOMAINS.length,
        domainsOk: domainIntels.filter((d) => !d.error).length,
        errors: domainIntels.filter((d) => d.error).length,
        signalCount: signals.length,
        sources: ['uapis.cn/icp', 'uapis.cn/whois', 'tmini.net/wechat-block'],
      },
    };
  } catch (e) {
    return {
      source: 'domain-intel-cn',
      timestamp,
      error: e.message,
      items: [],
      signals: [],
    };
  }
}

export { WATCH_DOMAINS, fetchWithTimeout };
