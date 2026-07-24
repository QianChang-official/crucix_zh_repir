// Crucix Intelligence Engine - Chinese Social Platform OSINT
// 中国社交平台OSINT数据源 - QQ 和 Bilibili 用户信息查询

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

const QQ_TARGETS = ['10001', '12345', '88888888'];
const BILI_TARGETS = ['1', '2', '546195'];

async function fetchQQInfo(qq) {
  try {
    const data = await fetchWithTimeout(`https://api.uapis.cn/api/qqinfo?qq=${encodeURIComponent(qq)}`);
    const info = {
      qq,
      ok: true,
      nickname: data.nickname || data.name || data.nick,
      avatar: data.avatar || data.qlogo || data.img,
      email: data.email || (data.qz_gdt ? undefined : undefined),
      level: data.level,
      gender: data.gender,
      country: data.country,
      province: data.province,
      city: data.city,
      rawData: typeof data === 'object' ? Object.keys(data).slice(0, 20) : []
    };
    return info;
  } catch (e) {
    return { qq, ok: false, error: e.message };
  }
}

async function fetchBiliInfo(uid) {
  try {
    const data = await fetchWithTimeout(`https://api.uapis.cn/api/biliinfo?uid=${encodeURIComponent(uid)}`);
    const info = {
      uid,
      ok: true,
      nickname: data.nickname || data.name,
      avatar: data.avatar || data.face,
      sign: data.sign,
      level: data.level,
      vipType: data.vipType,
      vipStatus: data.vipStatus,
      following: data.following,
      follower: data.follower,
      registrationDate: data.registrationDate || data.jointime,
      sex: data.sex,
      birthday: data.birthday,
      rawData: typeof data === 'object' ? Object.keys(data).slice(0, 20) : []
    };
    return info;
  } catch (e) {
    return { uid, ok: false, error: e.message };
  }
}

function analyzeSignals(qqResults, biliResults) {
  const signals = [];

  // QQ 账号异常特征
  for (const q of qqResults) {
    if (!q.ok) {
      signals.push({
        type: 'qq_lookup_failed',
        severity: 'low',
        target: q.qq,
        message: `QQ 查询失败: ${q.error}`
      });
      continue;
    }
    // 短数字 QQ 号 - 早期注册或测试号
    if (q.qq.length <= 5) {
      signals.push({
        type: 'short_qq_number',
        severity: 'info',
        target: q.qq,
        message: `短位 QQ 号 (${q.qq}),可能为早期注册或测试账号 - 昵称: ${q.nickname || '未知'}`
      });
    }
    // 8位以上 QQ 号 - 普通用户
    if (q.qq.length >= 8 && q.nickname) {
      signals.push({
        type: 'regular_qq_account',
        severity: 'info',
        target: q.qq,
        message: `常规 QQ 号: ${q.nickname}`
      });
    }
    // 腾讯管理员号 (10001 等已知号码)
    if (q.qq === '10001') {
      signals.push({
        type: 'tencent_admin_account',
        severity: 'medium',
        target: q.qq,
        message: `腾讯官方/管理员账号: ${q.nickname || '未知'}`
      });
    }
  }

  // Bilibili 账号异常特征
  for (const b of biliResults) {
    if (!b.ok) {
      signals.push({
        type: 'bili_lookup_failed',
        severity: 'low',
        target: b.uid,
        message: `Bilibili 查询失败: ${b.error}`
      });
      continue;
    }
    // 早期 UID (个位数)
    if (b.uid.length <= 2) {
      signals.push({
        type: 'early_bili_uid',
        severity: 'medium',
        target: b.uid,
        message: `早期 Bilibili UID (${b.uid}),可能为创始团队或测试账号 - 昵称: ${b.nickname || '未知'}`
      });
    }
    // 大量粉丝
    const followerCount = parseInt(b.follower);
    if (!isNaN(followerCount) && followerCount > 100000) {
      signals.push({
        type: 'high_follower_bili_account',
        severity: 'info',
        target: b.uid,
        message: `B站大V账号 (粉丝 ${followerCount}): ${b.nickname}`
      });
    }
    // VIP 账号
    if (b.vipType && b.vipType > 0) {
      signals.push({
        type: 'bili_vip_account',
        severity: 'info',
        target: b.uid,
        message: `B站会员账号: ${b.nickname} (VIP类型 ${b.vipType})`
      });
    }
    // 异常 - 注册时间缺失或账号为空
    if (!b.nickname && b.ok) {
      signals.push({
        type: 'bili_empty_account',
        severity: 'medium',
        target: b.uid,
        message: `B站账号疑似为空或已注销`
      });
    }
  }

  // 速率限制信号
  const failures = [...qqResults, ...biliResults].filter(r => !r.ok);
  if (failures.length > 3) {
    signals.push({
      type: 'possible_rate_limit',
      severity: 'high',
      message: `多个查询失败 (${failures.length}/${qqResults.length + biliResults.length}),可能触发速率限制`
    });
  }

  return signals;
}

export async function briefing() {
  try {
    const qqResults = [];
    for (const qq of QQ_TARGETS) {
      qqResults.push(await fetchQQInfo(qq));
      await sleep(500); // 避免速率限制
    }

    const biliResults = [];
    for (const uid of BILI_TARGETS) {
      biliResults.push(await fetchBiliInfo(uid));
      await sleep(500);
    }

    const signals = analyzeSignals(qqResults, biliResults);

    return {
      source: 'social-cn',
      timestamp: new Date().toISOString(),
      data: {
        qq: qqResults,
        bilibili: biliResults,
        summary: {
          totalQQ: qqResults.length,
          qqOk: qqResults.filter(q => q.ok).length,
          totalBili: biliResults.length,
          biliOk: biliResults.filter(b => b.ok).length,
          vipAccounts: biliResults.filter(b => b.vipType > 0).length,
          highFollowerAccounts: biliResults.filter(b => parseInt(b.follower) > 100000).length
        }
      },
      signals
    };
  } catch (e) {
    return { source: 'social-cn', timestamp: new Date().toISOString(), error: e.message, signals: [] };
  }
}

if (process.argv[1]?.endsWith('social-cn.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
