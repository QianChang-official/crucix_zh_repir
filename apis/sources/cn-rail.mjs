// Crucix Intelligence Engine - China Railway Transportation Intelligence
// 中国铁路交通情报数据源 - 基于 12306 公共接口

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://www.12306.cn/';

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Referer': REFERER,
        'Accept': '*/*',
        ...opts.headers
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { rawText: text.slice(0, 500) }; }
  } finally { clearTimeout(timer); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let stationCache = null;

async function fetchStationMap() {
  if (stationCache) return stationCache;
  try {
    const url = 'https://kyfw.12306.cn/otn/resources/js/framework/station_name.js';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let text;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': UA, 'Referer': REFERER, 'Accept': '*/*' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } finally { clearTimeout(timer); }

    const map = {};
    const match = text.match(/station_names\s*=\s*'([^']+)'/);
    if (match) {
      const entries = match[1].split('@').filter(Boolean);
      for (const entry of entries) {
        const parts = entry.split('|');
        if (parts.length >= 4) {
          const [abbr, name, code, py] = parts;
          map[name] = code;
        }
      }
    }
    stationCache = map;
    return map;
  } catch (e) {
    return {};
  }
}

function formatDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const POPULAR_ROUTES = [
  { name: 'Beijing-Shanghai', from: '北京', to: '上海' },
  { name: 'Beijing-Guangzhou', from: '北京', to: '广州' },
  { name: 'Shanghai-Shenzhen', from: '上海', to: '深圳' },
  { name: 'Beijing-Chengdu', from: '北京', to: '成都' }
];

async function queryRoute(route, stationMap, date) {
  const fromCode = stationMap[route.from];
  const toCode = stationMap[route.to];
  if (!fromCode || !toCode) {
    return { route: route.name, ok: false, error: `站点代码缺失: ${route.from}=${fromCode || '?'}, ${route.to}=${toCode || '?'}` };
  }
  try {
    const url = `https://kyfw.12306.cn/otn/leftTicket/queryZ?leftTicketDTO.train_date=${date}&leftTicketDTO.from_station=${fromCode}&leftTicketDTO.to_station=${toCode}&purpose_codes=ADULT`;
    const data = await fetchWithTimeout(url, {}, 14000);
    if (!data || !data.data || !Array.isArray(data.data.result)) {
      return {
        route: route.name,
        ok: true,
        empty: true,
        httpStatus: data?.httpstatus,
        messages: data?.messages,
        items: []
      };
    }
    const items = data.data.result.map(item => {
      const parts = item.split('|');
      return {
        trainNo: parts[2],
        fromStation: parts[6],
        toStation: parts[7],
        departTime: parts[8],
        arriveTime: parts[9],
        duration: parts[10],
        isStartStation: parts[11] === 'Y',
        isEndStation: parts[12] === 'Y',
        trainType: parts[3],
        canBuy: parts[11] === 'Y' && parts[12] === 'Y' ? parts[20] !== 'N' : false,
        seatAvailability: {
          business: parts[32] || '',
          firstClass: parts[31] || '',
          secondClass: parts[30] || '',
          advancedSoftSleeper: parts[33] || '',
          softSleeper: parts[23] || '',
          hardSleeper: parts[28] || '',
          hardSeat: parts[29] || '',
          noSeat: parts[26] || ''
        },
        prices: {
          trainNo: parts[2]
        }
      };
    });
    return {
      route: route.name,
      ok: true,
      from: route.from,
      to: route.to,
      date,
      count: items.length,
      items
    };
  } catch (e) {
    return { route: route.name, ok: false, error: e.message };
  }
}

function analyzeSignals(routeResults) {
  const signals = [];

  for (const r of routeResults) {
    if (!r.ok) {
      signals.push({
        type: 'route_query_failed',
        severity: 'medium',
        target: r.route,
        message: `线路查询失败: ${r.error}`
      });
      continue;
    }
    if (r.empty) {
      signals.push({
        type: 'route_empty',
        severity: 'low',
        target: r.route,
        message: `线路无可用车次`
      });
      continue;
    }
    if (!r.items || r.items.length === 0) continue;

    // 售罄车次
    const soldOut = r.items.filter(t => t.canBuy === false);
    if (soldOut.length === r.items.length) {
      signals.push({
        type: 'route_all_sold_out',
        severity: 'high',
        target: r.route,
        message: `${r.route} 所有车次均不可购买,可能全部售罄或停运`,
        count: soldOut.length
      });
    } else if (soldOut.length > r.items.length / 2) {
      signals.push({
        type: 'route_mostly_sold_out',
        severity: 'medium',
        target: r.route,
        message: `${r.route} 多数车次已售罄 (${soldOut.length}/${r.items.length})`,
        count: soldOut.length,
        total: r.items.length
      });
    }

    // 异常定价 - 检查无座
    const noSeatOnly = r.items.filter(t => {
      const avail = t.seatAvailability;
      const hasSeats = avail.hardSeat || avail.hardSleeper || avail.secondClass || avail.softSleeper;
      const hasNoSeat = avail.noSeat && avail.noSeat !== '' && avail.noSeat !== '无';
      return hasNoSeat && !hasSeats;
    });
    if (noSeatOnly.length > 0) {
      signals.push({
        type: 'only_no_seat_available',
        severity: 'info',
        target: r.route,
        message: `${r.route} 有 ${noSeatOnly.length} 趟车次仅余无座`,
        count: noSeatOnly.length
      });
    }

    // 异常时长 (超过8小时的普通车次)
    const longDuration = r.items.filter(t => {
      const m = t.duration?.match(/(\d+):(\d+)/);
      if (!m) return false;
      const hours = parseInt(m[1]);
      return hours >= 12 && t.trainType && /K|T|L/.test(t.trainType);
    });
    if (longDuration.length > 0) {
      signals.push({
        type: 'long_duration_train',
        severity: 'info',
        target: r.route,
        message: `${r.route} 有 ${longDuration.length} 趟长时长慢车 (>12h)`,
        count: longDuration.length
      });
    }
  }

  return signals;
}

export async function briefing() {
  try {
    const date = formatDate();
    const stationMap = await fetchStationMap();
    const stationCount = Object.keys(stationMap).length;

    const routeResults = [];
    for (const route of POPULAR_ROUTES) {
      const result = await queryRoute(route, stationMap, date);
      routeResults.push(result);
      await sleep(400);
    }

    const signals = analyzeSignals(routeResults);

    return {
      source: 'cn-rail',
      timestamp: new Date().toISOString(),
      data: {
        queryDate: date,
        stationsLoaded: stationCount,
        routes: routeResults,
        summary: {
          totalRoutes: routeResults.length,
          successRoutes: routeResults.filter(r => r.ok && !r.empty).length,
          failedRoutes: routeResults.filter(r => !r.ok).length,
          totalTrains: routeResults.reduce((sum, r) => sum + (r.count || 0), 0)
        }
      },
      signals
    };
  } catch (e) {
    return { source: 'cn-rail', timestamp: new Date().toISOString(), error: e.message, signals: [] };
  }
}

if (process.argv[1]?.endsWith('cn-rail.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
