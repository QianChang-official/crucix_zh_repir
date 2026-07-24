// 中国天气与气象预警数据源 - China Meteorological Administration
// 官方API: weather.cma.cn
const BASE = 'https://weather.cma.cn/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const CITIES = [
  { code: '54511', name: 'Beijing', cn: '北京' },
  { code: '58367', name: 'Shanghai', cn: '上海' },
  { code: '59287', name: 'Guangzhou', cn: '广州' },
  { code: '59493', name: 'Shenzhen', cn: '深圳' },
  { code: '56294', name: 'Chengdu', cn: '成都' },
  { code: '57516', name: 'Chongqing', cn: '重庆' },
  { code: '58457', name: 'Hangzhou', cn: '杭州' },
  { code: '58238', name: 'Nanjing', cn: '南京' },
];

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
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

function parseWeatherItem(city, data) {
  const now = data?.now;
  if (!now) return null;
  return {
    city: city.name,
    cityCn: city.cn,
    cityCode: city.code,
    temperature: parseFloat(now.temp),
    humidity: parseFloat(now.humidity),
    windDirection: now.windDir,
    windSpeed: parseFloat(now.windSpeed) || 0,
    pressure: parseFloat(now.pressure) || 0,
    precipitation: parseFloat(now.precip) || 0,
    weather: now.text,
    icon: now.icon,
    observedAt: now.obsTime,
  };
}

function parseAlarm(raw) {
  if (!raw) return null;
  return {
    id: raw.alertid || raw.id,
    title: raw.title,
    type: raw.alerttype || raw.type,
    level: raw.alertlevel || raw.level,
    area: raw.alertarea || raw.area,
    content: raw.alertContent || raw.content || raw.detail,
    publishedAt: raw.publishTime || raw.sendTime,
    source: raw.alertorg || raw.source,
  };
}

function buildWeatherSignals(items, alarms) {
  const signals = [];

  // 极端高温/低温信号
  for (const item of items) {
    if (item?.temperature == null) continue;
    if (item.temperature > 35) {
      signals.push({
        type: 'extreme_heat',
        severity: 'high',
        city: item.city,
        value: item.temperature,
        message: `${item.city} 高温 ${item.temperature}°C (>35°C 阈值)`,
      });
    }
    if (item.temperature < -10) {
      signals.push({
        type: 'extreme_cold',
        severity: 'high',
        city: item.city,
        value: item.temperature,
        message: `${item.city} 严寒 ${item.temperature}°C (<-10°C 阈值)`,
      });
    }
  }

  // 严重预警信号 (红色/橙色)
  const severeLevels = ['red', 'orange', '红色', '橙色', 'Red', 'Orange'];
  for (const alarm of alarms) {
    if (!alarm?.level) continue;
    const lv = String(alarm.level).toLowerCase();
    if (severeLevels.some((s) => lv.includes(s.toLowerCase()))) {
      signals.push({
        type: 'severe_weather_alarm',
        severity: lv.includes('red') || lv.includes('红') ? 'critical' : 'high',
        title: alarm.title,
        area: alarm.area,
        level: alarm.level,
        message: `[${alarm.level}] ${alarm.title} - ${alarm.area}`,
      });
    }
  }

  return signals;
}

async function fetchCityWeather(city) {
  try {
    const data = await fetchWithTimeout(`${BASE}/now/${city.code}`);
    if (data?.code !== 0 && data?.success !== true) return null;
    return parseWeatherItem(city, data?.data || data);
  } catch (e) {
    return { city: city.name, cityCn: city.cn, error: e.message };
  }
}

async function fetchAlarms() {
  try {
    const data = await fetchWithTimeout(`${BASE}/alarm`);
    const list = data?.data || data?.alarms || [];
    if (!Array.isArray(list)) return [];
    return list.map(parseAlarm).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function fetchProvinceOverview() {
  try {
    const data = await fetchWithTimeout(`${BASE}/map/weather/1`);
    return data?.data || data || null;
  } catch (e) {
    return null;
  }
}

export async function briefing() {
  const timestamp = new Date().toISOString();
  try {
    const [cityResults, alarms, provinceOverview] = await Promise.all([
      Promise.all(CITIES.map(fetchCityWeather)),
      fetchAlarms(),
      fetchProvinceOverview(),
    ]);

    const items = cityResults.filter((r) => r && !r.error);
    const errors = cityResults.filter((r) => r && r.error);
    const signals = buildWeatherSignals(items, alarms);

    return {
      source: 'cma-weather',
      timestamp,
      items,
      alarms,
      provinceOverview,
      signals,
      meta: {
        citiesQueried: CITIES.length,
        citiesOk: items.length,
        errors: errors.length,
        alarmCount: alarms.length,
        signalCount: signals.length,
      },
    };
  } catch (e) {
    return {
      source: 'cma-weather',
      timestamp,
      error: e.message,
      items: [],
      alarms: [],
      signals: [],
    };
  }
}

export { CITIES, fetchWithTimeout };
