# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] — 2026-07-25

### Added — 15 New OSINT Data Sources (54 total)

#### Tier 7: China Market & Finance
- **CN-Stock** (`cn-stock.mjs`) — A-share real-time quotes via Tmini.net
- **Gold-Price** (`gold-price.mjs`) — Gold prices (international/retail/bank/recycle) via Tmini.net
- **Exchange-Rate** (`exchange-rate.mjs`) — Live FX rates for 8 major currency pairs via open.er-api.com
- **CN-Fuel** (`cn-fuel.mjs`) — National fuel prices by province via Tmini.net
- **Baidu-Finance-Hot** (`baidu-finance-hot.mjs`) — Baidu finance trending topics via UAPIs.cn

#### Tier 8: China OSINT & Intel
- **IP-Geo** (`ip-geo.mjs`) — IP geolocation with proxy/risk detection via Tmini.net
- **CN-Weather** (`cn-weather.mjs`) — China weather + meteorological alerts via CMA
- **Domain-Intel-CN** (`domain-intel-cn.mjs`) — ICP/WHOIS/WeChat block status via UAPIs.cn + Tmini.net
- **Multi-Hotboard** (`multi-hotboard.mjs`) — 6-platform trending topics aggregator via UAPIs.cn
- **Phone-Intel** (`phone-intel.mjs`) — Phone number marking OSINT via Tmini.net
- **Translate** (`translate.mjs`) — Translation utility (en↔zh + 28 languages) via UAPIs.cn
- **Net-Tools** (`net-tools.mjs`) — Ping/DNS/Port scan network reconnaissance via UAPIs.cn
- **GitHub-Intel** (`github-intel.mjs`) — Trending repos + security advisories via GitHub API
- **CN-Rail** (`cn-rail.mjs`) — China railway schedules via 12306
- **Social-CN** (`social-cn.mjs`) — QQ/Bilibili account info via UAPIs.cn

### Added — 11 New RESTful API v2 Endpoints
- `GET /api/v2/sources` — List all 54 available sources
- `GET /api/v2/source/:name` — Trigger a single source on-demand
- `GET /api/v2/china/market` — Aggregated China market data (stock + gold + fuel + FX)
- `GET /api/v2/china/osint` — Aggregated China OSINT (IP + domain + phone + social)
- `GET /api/v2/china/weather` — China weather and meteorological alerts
- `GET /api/v2/hotboard` — Multi-platform trending topics
- `GET /api/v2/github-intel` — GitHub trending repos + security advisories
- `GET /api/v2/net-tools` — Network reconnaissance toolkit
- `POST /api/v2/translate` — Text translation
- `GET /api/v2/china/rail` — China railway information
- `GET /api/v2/sweep-status` — Detailed sweep cycle status

### Added — Test Suite
- `scripts/run-tests.mjs` — Zero-dependency test framework (54 tests)
- 7 unit test suites + 3 integration + 5 e2e (all passing)
- HTML report generator at `test-results/test-report.html`
- npm scripts: `test`, `test:unit`, `test:integration`, `test:e2e`, `test:report`

### Added — Documentation
- `docs/API_v2.md` — Complete API documentation (v1 + v2 endpoints)

### Performance — GPU Optimization (60fps sustained)
- **Removed all 9 `backdrop-filter: blur()`** instances — eliminated 15-20% per-frame GPU overhead
- **Capped WebGL pixelRatio to 1.5** — 44% fewer fragment shader executions on 2x DPI displays
- **Disabled MSAA antialiasing** — atmosphere glow + dark earth texture masks aliasing
- **Added THREE.Fog culling** — skips fragment shading on distant objects
- **Optimized star field** — `sizeAttenuation:false` + `depthWrite:false` = single draw call
- **Reduced star particles** — 2000 → 1200 (400 in LITE mode)
- **Added `contain: layout style paint`** on panels — isolates repaint regions
- **Added `will-change: transform`** — hints browser to pre-create GPU compositing layers
- **Capped flight corridors** — top 15 by traffic (top 8 in LITE), hub arcs capped at 12 (6 in LITE)
- **RAF-based clock** — replaced 50ms `setInterval` with `requestAnimationFrame` + 200ms throttle
- **Visibility-based pause** — stops all RAF + globe animation when tab hidden
- **FPS monitor** — real-time display in perf pill, no auto-degrade

### Performance — Source Timeout Optimization
- GDELT/EPA/OFAC/Space: independent 15s timeout (default 30s)
- Total sweep time reduced from ~30s to ~15s

### Fixed
- **MemoryManager tier mapping bug** — `isSignalSuppressed()` now correctly maps count=1 → tier[0]=0h (was tier[1]=6h)
- **diag.mjs ESM compatibility** — `net.default.createServer()` → `net.createServer()`
- **Express 5 POST body parsing** — added `express.json()` middleware
- **Translate endpoint** — uses `req.body` instead of manual stream parsing

### Changed
- Version bumped: 2.1.0 → 2.2.0
- Source count: 39 → 54
- Description updated to reflect 54 sources

## [2.1.0] — 2026-07-24

### Changed
- express upgraded: ^5.1.0 → 5.2.1
- Security overrides added: undici ^7.30.0, ws ^8.21.0, qs ^6.15.2, path-to-regexp ^8.4.0, body-parser ^2.3.0
- 0 npm audit vulnerabilities

### Fixed
- diag.mjs: `net.default.createServer()` → `net.createServer()` for ESM compatibility

## [2.0.0] — 2026-04-05

- Initial public release
- 27 OSINT sources, Express 5 server, SQLite persistence, multi-LLM, Telegram/Discord alerts
- 3D WebGL globe + D3 flat map, SSE live updates, i18n (zh/en/fr)
