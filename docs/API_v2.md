# Crucix Intelligence Engine v2.2.0 — API Documentation

## Overview

- **Base URL**: `http://localhost:3117`
- **Total Sources**: 54 (39 original + 15 new v2.2)
- **Content-Type**: `application/json`
- **Authentication**: None required (local server)

---

## Core API Endpoints (v1)

### GET /api/data
Returns the current synthesized dashboard data from the latest sweep.

**Response**: Full synthesized intelligence data including all source results, delta computations, and trade ideas.

### GET /api/health
System health check with operational metrics.

**Response**:
```json
{
  "status": "ok",
  "uptime": 3600,
  "lastSweep": "2026-07-25T00:00:00.000Z",
  "nextSweep": "2026-07-25T00:15:00.000Z",
  "sweepInProgress": false,
  "configuredSources": 54,
  "sourcesOk": 50,
  "sourcesFailed": 4,
  "llmEnabled": false,
  "refreshIntervalMinutes": 15
}
```

### GET /api/locales
Returns supported locales and current language.

### GET /api/history/sweeps
Returns recent sweep run records from SQLite.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | int | 20 | Max 100 |

### GET /api/history/section/:name
Returns historical snapshots for a specific data section.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | int | 10 | Max 50 |

### GET /api/history/news
Search and filter news history.

| Parameter | Type | Description |
|-----------|------|-------------|
| source | string | Filter by source name |
| since | ISO date | Filter by publish date |
| q | string | Full-text search (max 100 chars) |
| limit | int | Max 200, default 50 |

### GET /events
Server-Sent Events stream for live updates. Pushes `sweep_start`, `update`, and `sweep_error` events.

---

## NEW v2.2 API Endpoints

### GET /api/v2/sources
Lists all 54 available intelligence sources.

**Response**:
```json
{
  "total": 54,
  "sources": [
    { "name": "GDELT", "hasArgs": false },
    { "name": "FRED", "hasArgs": true },
    ...
  ]
}
```

### GET /api/v2/source/:name
Triggers a single source on-demand and returns its raw data.

**Example**: `GET /api/v2/source/CN-Stock`

**Response**:
```json
{
  "name": "CN-Stock",
  "status": "ok",
  "durationMs": 1234,
  "data": { ... }
}
```

**Error (source not found)**:
```json
{
  "error": "Source \"InvalidName\" not found",
  "available": ["GDELT", "OpenSky", ...]
}
```

### GET /api/v2/china/market
Aggregated China market data in a single call. Combines:
- A-share real-time quotes (上证/深证/沪深300/上证50)
- Gold prices (国际金价/品牌金店/银行金条/回收价)
- National fuel prices (各省0号柴油/89/92/95/98)
- Exchange rates (USD/CNY, EUR/CNY, JPY/CNY, etc.)

**Response**:
```json
{
  "timestamp": "2026-07-25T00:00:00.000Z",
  "stock": { "source": "CN-Stock", ... },
  "gold": { "source": "Gold-Price", ... },
  "fuel": { "source": "CN-Fuel", ... },
  "exchangeRate": { "source": "Exchange-Rate", ... }
}
```

### GET /api/v2/china/osint
Aggregated China OSINT intelligence. Combines:
- IP geolocation with proxy/risk detection
- Domain intelligence (ICP/WHOIS/WeChat block status)
- Phone number marking (carrier, labels, harassment status)
- Social media account info (QQ, Bilibili)

### GET /api/v2/china/weather
China weather and meteorological alerts for 8 major cities.

**Response**: Real-time temperature, humidity, wind, pressure for Beijing, Shanghai, Guangzhou, Shenzhen, Chengdu, Chongqing, Hangzhou, Nanjing. Plus national weather alerts (type, level, area).

### GET /api/v2/hotboard
Multi-platform trending topics aggregator. Covers:
- Baidu, Weibo, Zhihu, Douyin, Bilibili, Toutiao

Returns cross-platform trending topics with deduplication and resonance detection.

### GET /api/v2/github-intel
GitHub intelligence monitor. Returns:
- Trending repositories (created in last 30 days, sorted by stars)
- Security advisories (GHSA/CVE with severity and affected packages)

### GET /api/v2/net-tools
Network reconnaissance toolkit. Performs:
- Ping tests (baidu.com, google.com, github.com)
- DNS resolution (A records for major domains)
- Port scans (80, 443 on target hosts)

### POST /api/v2/translate
Translate text between languages.

**Request Body**:
```json
{
  "text": "Hello world",
  "from": "en",
  "to": "zh"
}
```

**Response**:
```json
{
  "original": "Hello world",
  "translated": "你好世界",
  "from": "en",
  "to": "zh"
}
```

### GET /api/v2/china/rail
China railway information for popular routes (12306 data).

Routes: Beijing-Shanghai, Beijing-Guangzhou, Shanghai-Shenzhen, Beijing-Chengdu.

Returns: train numbers, departure/arrival times, duration, prices, seat availability.

### GET /api/v2/sweep-status
Detailed sweep cycle status and timing.

**Response**:
```json
{
  "sweepInProgress": false,
  "lastSweepTime": "2026-07-25T00:00:00.000Z",
  "nextSweep": "2026-07-25T00:15:00.000Z",
  "uptime": 3600,
  "sseClients": 2,
  "totalSources": 54,
  "lastDelta": {
    "totalChanges": 5,
    "criticalChanges": 1,
    "direction": "risk-off"
  }
}
```

---

## New Data Sources (v2.2)

### Tier 7: China Market & Finance

| Source Name | File | Data Provider | Description |
|-------------|------|---------------|-------------|
| CN-Stock | cn-stock.mjs | Tmini.net | A-share real-time quotes (indexes + individual stocks) |
| Gold-Price | gold-price.mjs | Tmini.net | Gold prices (international, retail, bank, recycle) |
| Exchange-Rate | exchange-rate.mjs | open.er-api.com | Live FX rates for 8 major currency pairs |
| CN-Fuel | cn-fuel.mjs | Tmini.net | National fuel prices by province |
| Baidu-Finance-Hot | baidu-finance-hot.mjs | UAPIs.cn | Baidu finance trending topics |

### Tier 8: China OSINT & Intel

| Source Name | File | Data Provider | Description |
|-------------|------|---------------|-------------|
| IP-Geo | ip-geo.mjs | Tmini.net | IP geolocation with proxy/risk detection |
| CN-Weather | cn-weather.mjs | CMA (weather.cma.cn) | China weather + meteorological alerts |
| Domain-Intel-CN | domain-intel-cn.mjs | UAPIs.cn + Tmini.net | ICP/WHOIS/WeChat block status |
| Multi-Hotboard | multi-hotboard.mjs | UAPIs.cn | 6-platform trending topics aggregator |
| Phone-Intel | phone-intel.mjs | Tmini.net | Phone number marking OSINT |
| Translate | translate.mjs | UAPIs.cn | Translation utility (en↔zh + 28 languages) |
| Net-Tools | net-tools.mjs | UAPIs.cn | Ping/DNS/Port scan network reconnaissance |
| GitHub-Intel | github-intel.mjs | GitHub API | Trending repos + security advisories |
| CN-Rail | cn-rail.mjs | 12306.cn | China railway schedules and availability |
| Social-CN | social-cn.mjs | UAPIs.cn | QQ/Bilibili account info OSINT |

---

## Error Handling

All API endpoints return appropriate HTTP status codes:

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Bad request (missing required parameter) |
| 404 | Resource not found |
| 500 | Internal server error |
| 503 | Service unavailable (no data yet) |

Error response format:
```json
{
  "error": "Description of the error",
  "source": "SourceName"  // if applicable
}
```

---

## Backward Compatibility

All v1 API endpoints remain unchanged. The v2.2 update is fully backward compatible:
- Existing `/api/data`, `/api/health`, `/api/history/*` endpoints work exactly as before
- Existing dashboard HTML and SSE stream are unaffected
- Existing Telegram/Discord bot commands work unchanged
- SQLite schema is unchanged (new sources are handled by existing `saveSectionSnapshot`)
- Configuration file (`crucix.config.mjs`) structure is unchanged

---

## Bug Fixes in v2.2

1. **MemoryManager tier mapping bug** (FIXED): `isSignalSuppressed()` was mapping count=1 to tier[1]=6h instead of tier[0]=0h. Fixed by using `occurrences - 1` as the tier index.
2. **diag.mjs net.default.createServer()** (FIXED in v2.1): Changed to `net.createServer()` for ESM compatibility.
3. **Express 5 JSON body parsing** (NEW): Added `express.json()` middleware for POST request support.
