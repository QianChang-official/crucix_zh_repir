<div align="center">

<img src="https://img.shields.io/badge/⚡-CRUCIX_战情终端-0d1117?style=for-the-badge&labelColor=0d1117" alt="Crucix">

# Crucix 中文增强分支 · 本地情报引擎

[![上游仓库](https://img.shields.io/badge/上游源库-calesthio%2FCrucix-181717?style=flat-square&logo=github)](https://github.com/calesthio/Crucix)
&ensp;
[![本仓库](https://img.shields.io/badge/当前分支-QianChang--official%2Fcrucix__zh__repir-2563eb?style=flat-square&logo=github)](https://github.com/QianChang-official/crucix_zh_repir)
&ensp;
[![Node](https://img.shields.io/badge/Node.js-≥22-22c55e?style=flat-square&logo=node.js&logoColor=white)](#-快速启动)
&ensp;
[![License](https://img.shields.io/badge/License-AGPL--3.0-a855f7?style=flat-square)](LICENSE)

**39 个 OSINT 数据源 · 10 种 LLM 提供商 · SQLite 持久化 · 实时 SSE 推送 · 中文全量汉化**

一个跑在本地的 Palantir 平替 —— 军事空域、热点卫星、全球冲突、宏观经济、中国财讯、网络安全、太空动态，全部汇聚到一个页面。

---

[快速启动](#-快速启动) · [与源库的区别](#-与源库-calesthiocrucix-的区别) · [数据源一览](#-39-个数据源全表) · [API 限制说明](#-api-额度与限制) · [LLM 配置](#-10-种-llm-提供商) · [环境变量](#-环境变量参考) · [未来可加的 API](#-还能加哪些-api)

</div>

---

## 📌 这个项目是干什么的

Crucix 是一个**本地部署的开源情报仪表板**（OSINT Dashboard），每 15 分钟自动从 39 个公开数据源拉取信息，经过聚合、去重、聚类和增量检测后展示在一张实时页面上。

**核心能力：**

| 模块 | 内容 |
|:-----|:-----|
| 🛩️ **军事空域** | 全球 10 个热点空域的军机活动（OpenSky + Airplanes.live MIL） |
| 🔥 **热点卫星** | NASA FIRMS 卫星火点探测、NOAA 气象预警 |
| ⚔️ **全球冲突** | ACLED 武装冲突事件、GDELT 全球事件数据库 |
| 📈 **宏观经济** | FRED 利率/失业率、Treasury 财政、BLS 劳工、EIA 能源 |
| 🇨🇳 **中国财讯** | 财联社电报、东方财富 7×24、同花顺快讯、热榜聚合 |
| 💹 **全球市场** | Yahoo Finance 实时行情、中港市场（上证/深证/沪深300/恒生） |
| 🛡️ **网络安全** | CISA-KEV 漏洞、NVD CVE、Cloudflare 互联网中断检测 |
| 🚀 **太空动态** | CelesTrak 卫星轨道、航天新闻、发射日历 |
| 🌊 **海事监控** | AIS 船舶追踪（AISStream WebSocket） |
| 📡 **公开情报** | Telegram 频道监控、Reddit、Bluesky 社交信号 |
| ✈️ **航班延误** | Flightera 机场延误观察（可选） |
| 🤖 **AI 观点** | 10 种 LLM 自动生成交易观点和告警摘要（可选） |

**不需要任何 API Key 也能启动** —— 大部分源是完全公开的。有 Key 的源会自动增强数据质量。

---

## 🔗 与源库 [calesthio/Crucix](https://github.com/calesthio/Crucix) 的区别

> 上游源库：**https://github.com/calesthio/Crucix**

| 维度 | 上游 Crucix | 本分支 (crucix_zh_repir) |
|:-----|:-----------|:------------------------|
| **语言** | 英文 UI + 英文术语 | 全量中文汉化（i18n zh.json + UI文案） |
| **数据源数** | 27 个 | **39 个**（+12 个新增源） |
| **中国新闻** | 无 | ✅ 财联社电报直接抓取 + 东方财富/同花顺 RSS + 热榜聚合 |
| **中港市场** | 无 | ✅ 上证/深证/沪深300/恒生/中国主题 ETF |
| **新闻聚类** | 基础 | ✅ 同题多源聚合 + 口径冲突检测（确认/否认/上升/下降） |
| **LLM 提供商** | 9 个 | **10 个**（+Microsoft 365 Copilot / Azure OpenAI） |
| **数据持久化** | 仅文件缓存 (runs/) | ✅ SQLite 数据库（sweep 记录/新闻/航班缓存/版块快照） |
| **历史查询 API** | 无 | ✅ `/api/history/sweeps`、`/api/history/news`、`/api/history/section/:name` |
| **航班缓存** | 每次 sweep 都调 API | ✅ 每日一次查询，SQLite 缓存全天复用 |
| **失效源显示** | 仅日志 | ✅ 前端可点击面板，列出失效源名称和错误原因 |
| **页面布局** | 全部堆在一页 | ✅ 标签页导航（新闻/市场/OSINT/观点）+ localStorage 记忆 |
| **CLS 电报** | 无 | ✅ 直接调用 cls.cn 内部 API，双端点故障转移 |
| **时间显示** | UTC 为主 | ✅ 来源地时间 + 北京时间 + 毫秒授时中心 |
| **面板滚动** | 滚轮翻页 | ✅ 自然滚动 + 固定高度 |
| **FRED 降级** | 无 Key 则空 | ✅ fredgraph CSV fallback，无 Key 也有数据 |
| **Docker** | ✅ | ✅ 完全兼容 |

**本仓库不是上游官方发行版。** 核心代码结构和思路来自上游 Crucix，本分支在此基础上做了中文本地化、国内源集成、数据持久化等增强。如上游维护者或相关权利方要求调整，将尽快处理。

---

## 🚀 快速启动

### 前置要求

- **Node.js ≥ 22**（推荐 22.x LTS）
- **npm ≥ 10**
- Windows / macOS / Linux 均可
- （可选）Python 3.x —— 如需运行 China Finance RSS Bridge

### 从本仓库克隆后的完整操作

```bash
# 1. 克隆仓库
git clone https://github.com/QianChang-official/crucix_zh_repir.git
cd crucix_zh_repir

# 2. 安装依赖（含 better-sqlite3 本地编译）
npm install

# 3. 复制并编辑环境变量（可选，不配也能跑）
copy .env.example .env        # Windows
# cp .env.example .env        # macOS/Linux

# 4. 启动服务
npm start
# 或开发模式（显示警告追踪）
npm run dev

# 5. 打开浏览器
#    http://localhost:3117
```

### 其他常用命令

| 命令 | 说明 |
|:-----|:-----|
| `npm start` | 启动服务器 |
| `npm run dev` | 启动 + 警告追踪 |
| `npm run sweep` | 单独执行一次源抓取 |
| `npm run inject` | 执行一次数据聚合 |
| `npm run diag` | 诊断环境和依赖状态 |
| `npm run clean` | 清理缓存（runs/） |
| `npm run fresh-start` | 清理缓存后重启 |

### Docker 部署

```bash
# 方式一：docker-compose（推荐）
docker-compose up -d

# 方式二：手动构建
docker build -t crucix .
docker run -d -p 3117:3117 --env-file .env -v ./runs:/app/runs crucix
```

### 可选：启动 China Finance RSS Bridge

如需东方财富 7×24 + 同花顺快讯数据，需额外运行本地 RSS 桥接服务：

```bash
# 另一个终端
git clone https://github.com/yuxuan-made/china-finance-rss.git
cd china-finance-rss
pip install -r requirements.txt
python server.py
# 默认运行在 http://localhost:8053
```

在 `.env` 中设置（或保持默认）：
```
CN_FINANCE_RSS_URL=http://localhost:8053
```

---

## 📡 39 个数据源全表

### Tier 1：核心地缘政治与公开情报

| # | 源名称 | API 端点 | 认证 | 说明 |
|:-:|:-------|:---------|:----:|:-----|
| 1 | **GDELT** | `api.gdeltproject.org/api/v2` | 无 | 全球事件数据库，每 15 分钟更新 |
| 2 | **OpenSky** | `opensky-network.org/api` | 可选 | 军/民航 ADS-B 跟踪 |
| 3 | **FIRMS** | `firms.modaps.eosdis.nasa.gov` | Key | NASA 卫星热点/火灾探测 |
| 4 | **Maritime** | `aisstream.io` WebSocket | Key | 全球船舶 AIS 实时推流 |
| 5 | **Safecast** | `api.safecast.org` | 无 | 全球辐射水平监测 |
| 6 | **ACLED** | `acleddata.com/api` | 邮箱+密码 | 武装冲突事件数据库 |
| 7 | **ReliefWeb** | `api.reliefweb.int/v1` | 无 | 联合国人道危机报告 |
| 8 | **WHO** | `ghoapi.azureedge.net/api` | 无 | 世卫组织卫生数据 |
| 9 | **OFAC** | `sanctionslistservice.ofac.treas.gov` | 无 | 美国制裁名单 |
| 10 | **OpenSanctions** | `api.opensanctions.org` | 无 | 全球制裁/执法数据 |
| 11 | **ADS-B** | `adsbexchange.com` (RapidAPI) | 可选 | 备用空域数据源 |

### Tier 2：经济与金融

| # | 源名称 | API 端点 | 认证 | 说明 |
|:-:|:-------|:---------|:----:|:-----|
| 12 | **FRED** | `api.stlouisfed.org/fred` | Key | 美联储经济数据（利率/GDP/失业率等） |
| 13 | **Treasury** | `api.fiscaldata.treasury.gov` | 无 | 美国财政部财务数据 |
| 14 | **BLS** | `api.bls.gov/publicAPI` | 可选 | 美国劳工统计局 |
| 15 | **EIA** | `api.eia.gov/v2` | Key | 能源信息署（原油/天然气/煤炭） |
| 16 | **GSCPI** | `newyorkfed.org` CSV | 无 | 纽约联储全球供应链压力指数 |
| 17 | **USAspending** | `api.usaspending.gov/api/v2` | 无 | 美国联邦支出追踪 |
| 18 | **Comtrade** | `comtradeapi.un.org/public/v1` | 无 | 联合国贸易数据 |
| 19 | **WorldBank** | `api.worldbank.org/v2` | 无 | 世界银行发展指标 |
| 20 | **Hot-News** ⭐ | `orz.ai/api/v1/dailynews` | 无 | 中文热榜聚合（财联社/东财/雪球等） |
| 21 | **CN-Finance-RSS** ⭐ | `localhost:8053` | 无 | 东方财富 7×24 + 同花顺快讯（本地桥接） |
| 22 | **CLS-Telegraph** ⭐ | `cls.cn/nodeapi` | 无 | 财联社电报直接抓取 |
| 23 | **Flightera** | RapidAPI | Key | 机场航班延误观察 |

### Tier 3：天气、环境与社交

| # | 源名称 | API 端点 | 认证 | 说明 |
|:-:|:-------|:---------|:----:|:-----|
| 24 | **NOAA** | `api.weather.gov` | 无 | 美国国家气象局 |
| 25 | **EPA** | `enviro.epa.gov` | 无 | 美国环保署辐射监测网 |
| 26 | **Patents** | `search.patentsview.org/api/v1` | 无 | 美国专利搜索 |
| 27 | **Bluesky** | `public.api.bsky.app/xrpc` | 无 | Bluesky 社交信号 |
| 28 | **Reddit** | `reddit.com/api` | 可选 | Reddit 热门话题 |
| 29 | **Telegram** | `t.me/s/` 网页抓取 + Bot API | Token | 频道监控 + Bot 双向交互 |
| 30 | **KiwiSDR** | `receiverbook.de` | 无 | 全球软件定义无线电接收器地图 |
| 31 | **USGS-Earthquakes** | `earthquake.usgs.gov` | 无 | 全球地震数据 |
| 32 | **NASA-EONET** | `eonet.gsfc.nasa.gov/api/v3` | 无 | NASA 地球自然事件追踪 |

### Tier 4：太空与卫星

| # | 源名称 | API 端点 | 认证 | 说明 |
|:-:|:-------|:---------|:----:|:-----|
| 33 | **Space** | `celestrak.org` | 无 | 卫星 TLE 轨道数据 |
| 34 | **Spaceflight-News** | `api.spaceflightnewsapi.net/v4` | 无 | 航天新闻 API |
| 35 | **Launch-Library** | `ll.thespacedevs.com/2.3.0` | 无 | 全球火箭发射日历 |

### Tier 5：实时行情

| # | 源名称 | API 端点 | 认证 | 说明 |
|:-:|:-------|:---------|:----:|:-----|
| 36 | **YFinance** | `query1.finance.yahoo.com` | 无 | 全球股票/指数/商品/加密货币 |

### Tier 6：网络安全

| # | 源名称 | API 端点 | 认证 | 说明 |
|:-:|:-------|:---------|:----:|:-----|
| 37 | **CISA-KEV** | `cisa.gov` JSON Feed | 无 | 已知被利用漏洞目录 |
| 38 | **Cloudflare-Radar** | `api.cloudflare.com/client/v4/radar` | Token | 互联网流量/中断检测 |
| 39 | **NVD** | `services.nvd.nist.gov` | 无 | NIST 国家漏洞数据库 |

> ⭐ 标记为本分支新增的中国数据源

---

## 🔑 API 额度与限制

### ✅ 完全免费、无限调用（无需 Key）

以下源是纯公开接口，没有认证要求，没有明确的每日额度限制：

| 源 | 说明 |
|:---|:-----|
| GDELT | 基于 BigQuery 公开数据，每 15 分钟更新 |
| Treasury | 美国财政部公开数据，无限制 |
| GSCPI | 纽约联储 CSV 静态文件下载 |
| USAspending | 美国联邦支出数据，公开 API |
| Comtrade | 联合国公开贸易数据 |
| WorldBank | 世界银行公开数据 |
| YFinance | Yahoo Finance 公开行情接口 |
| NOAA | 美国气象局公开数据 |
| EPA | 美国环保署辐射数据 |
| Patents | 专利数据公开搜索 |
| Bluesky | 公开社交 API（AT Protocol） |
| KiwiSDR | 无线电接收器地图 |
| USGS-Earthquakes | 美国地质调查局地震数据 |
| NASA-EONET | NASA 地球自然事件 |
| Space (CelesTrak) | 卫星轨道 TLE 公开数据 |
| Spaceflight-News | 航天新闻公开 API |
| Launch-Library | 发射日历公开 API |
| CISA-KEV | 已知漏洞 JSON Feed |
| NVD | 国家漏洞数据库 |
| Safecast | 辐射监测开放数据 |
| WHO | 世卫组织数据 API |
| OFAC | 制裁名单公开导出 |
| OpenSanctions | 制裁数据公开层 |
| ReliefWeb | 人道危机报告 |
| Hot-News | orz.ai 热榜公共接口 |
| CLS-Telegraph | 财联社电报内部 API（无认证） |

### ⚠️ 有额度限制或需要免费 Key

| 源 | Key 变量 | 限制详情 | 获取方式 |
|:---|:---------|:---------|:---------|
| **FRED** | `FRED_API_KEY` | 120 次请求/分钟 | [免费注册](https://fred.stlouisfed.org/docs/api/api_key.html) |
| **FIRMS** | `FIRMS_MAP_KEY` | 需 Map Key，额度充足 | [免费申请](https://firms.modaps.eosdis.nasa.gov/api/area/) |
| **EIA** | `EIA_API_KEY` | 有 Key 后基本不限 | [免费注册](https://www.eia.gov/opendata/register.php) |
| **OpenSky** | 可选（匿名可用） | 匿名 4,000 积分/天；注册 8,000/天 | [免费注册](https://opensky-network.org/index.php/login) |
| **BLS** | 可选（v1 免 Key） | v1 有速率限制；v2 Key = 更高限额 | [免费注册](https://data.bls.gov/registrationEngine/) |
| **Cloudflare-Radar** | `CLOUDFLARE_API_TOKEN` | 需免费 API Token | [Cloudflare 仪表板](https://dash.cloudflare.com/profile/api-tokens) |
| **ACLED** | `ACLED_EMAIL` + `ACLED_PASSWORD` | 无明确上限但需认证 | [免费注册](https://acleddata.com/data-export-tool/) |

### 💰 付费/有限调用

| 源 | Key 变量 | 限制详情 |
|:---|:---------|:---------|
| **ADS-B** (RapidAPI) | `ADSB_RAPIDAPI_KEY` | 取决于 RapidAPI 计划，免费层有月限 |
| **Flightera** (RapidAPI) | `FLIGHTERA_RAPIDAPI_KEY` | RapidAPI 免费层约 100-500 次/月 |
| **Maritime** (AISStream) | `AISSTREAM_API_KEY` | 免费层有连接数限制 |

### 🤖 LLM 提供商费用

| 提供商 | 免费额度 |
|:-------|:---------|
| **Ollama** | 完全免费（本地运行） |
| **Gemini** | 免费层可用 |
| **Grok** | X Premium 用户免费 |
| **OpenRouter** | 部分模型免费 |
| **Anthropic** | 按量付费 |
| **OpenAI** | 按量付费 |
| **Mistral** | 有免费层 |
| **MiniMax** | 有免费层 |
| **Copilot/Azure** | Azure 信用额度可用 |
| **Codex** | 本地 CLI 工具 |

---

## 🤖 10 种 LLM 提供商

LLM 是**完全可选**的，不配置不影响核心情报功能。配置后可获得：
- 🧠 AI 驱动的交易/情报观点自动生成
- 📝 Breaking News 告警摘要增强
- 🔄 增量信号综合分析

| 提供商 | `LLM_PROVIDER` 值 | 默认模型 | 备注 |
|:-------|:-------------------|:---------|:-----|
| Anthropic | `anthropic` | claude-sonnet-4-6 | Claude 系列 |
| OpenAI | `openai` | gpt-5.4 | GPT 系列 |
| Google Gemini | `gemini` | gemini-3.1-pro | 免费层可用 |
| OpenRouter | `openrouter` | auto | 多模型聚合 |
| MiniMax | `minimax` | MiniMax-M2.5 | 国产大模型 |
| Mistral | `mistral` | mistral-large | 欧洲开源 |
| Ollama | `ollama` | llama3.1:8b | 本地部署，完全免费 |
| Codex | `codex` | gpt-5.3-codex | 本地 CLI |
| Grok | `grok` | grok-4-latest | xAI |
| Microsoft Copilot ⭐ | `copilot` | gpt-4o | Azure OpenAI 或 Graph API |

> ⭐ 本分支新增

配置示例：
```env
LLM_PROVIDER=ollama
# Ollama 无需 Key，确保 ollama 服务在运行
OLLAMA_BASE_URL=http://localhost:11434

# 或使用 Azure OpenAI
LLM_PROVIDER=copilot
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_KEY=your-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

---

## ⚙️ 环境变量参考

完整变量定义在 [.env.example](.env.example)，按优先级分组：

### 服务器配置

```env
PORT=3117                          # 服务端口（默认 3117）
REFRESH_INTERVAL_MINUTES=15        # 自动刷新间隔（分钟）
LANGUAGE=zh                        # 界面语言 zh/en/fr
```

### 强烈推荐配置的 Key（免费注册）

```env
FRED_API_KEY=                      # 宏观经济骨架数据
EIA_API_KEY=                       # 能源市场数据
FIRMS_MAP_KEY=                     # NASA 卫星火点
```

### 可选增强

```env
ACLED_EMAIL=                       # 武装冲突数据库
ACLED_PASSWORD=
CLOUDFLARE_API_TOKEN=              # 互联网中断检测
AISSTREAM_API_KEY=                 # 海事 AIS 数据
FLIGHTERA_RAPIDAPI_KEY=            # 机场延误（RapidAPI）
FLIGHTERA_AIRPORTS=ZBAA,ZSPD,VHHH # 监控的机场 ICAO 码
```

### LLM（完全可选）

```env
LLM_PROVIDER=                      # anthropic|openai|gemini|openrouter|minimax|mistral|ollama|codex|grok|copilot
LLM_API_KEY=                       # 大部分需要
LLM_MODEL=                         # 覆盖默认模型

# Ollama（本地）
OLLAMA_BASE_URL=http://localhost:11434

# Azure OpenAI（仅 copilot 提供商）
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_KEY=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=
```

### 告警推送（可选）

```env
# Telegram
TELEGRAM_BOT_TOKEN=                # @BotFather 创建
TELEGRAM_CHAT_ID=                  # @userinfobot 获取

# Discord
DISCORD_BOT_TOKEN=
DISCORD_CHANNEL_ID=
DISCORD_WEBHOOK_URL=
```

### 中国源（可选）

```env
CN_FINANCE_RSS_URL=http://localhost:8053  # China Finance RSS Bridge 地址
```

---

## 🗃️ 数据持久化

本分支新增 SQLite 持久化层（`lib/db.mjs`），使用 `better-sqlite3` WAL 模式：

| 表 | 存储内容 | 用途 |
|:---|:---------|:-----|
| `sweep_runs` | 每次扫描的元数据（时间/源数/耗时） | 历史趋势分析 |
| `source_data` | 每个源每次扫描的状态和数据 | 源健康度追踪 |
| `news_items` | 所有新闻条目 | 历史新闻查询 |
| `flight_cache` | 航班延误数据 | 每日缓存，减少 API 调用 |
| `section_snapshots` | 各版块快照 | 历史回溯 |

### 历史查询 API

```
GET /api/history/sweeps          # 最近扫描记录
GET /api/history/news            # 历史新闻
GET /api/history/section/:name   # 指定版块历史（air/markets/cnNews 等）
```

数据库文件位于 `data/crucix.db`，启动时自动创建，每次启动清理 30 天前旧数据。

---

## 📁 项目结构

```
crucix/
├── apis/                              # 数据源抓取层
│   ├── briefing.mjs                   # 源编排：39 源并行、30s 超时
│   ├── save-briefing.mjs              # 结果持久化
│   ├── sources/                       # 39 个 .mjs 源文件
│   │   ├── gdelt.mjs                  # 全球事件数据库
│   │   ├── opensky.mjs                # 空域监控
│   │   ├── cls-telegraph.mjs          # ⭐ 财联社电报直接抓取
│   │   ├── cn-finance-rss.mjs         # ⭐ 东财/同花顺 RSS
│   │   ├── hot-news.mjs               # ⭐ 中文热榜聚合
│   │   └── ... (36 more)
│   └── utils/
│       ├── env.mjs                    # dotenv 加载
│       └── fetch.mjs                  # safeFetch（超时/重试）
├── lib/                               # 核心逻辑
│   ├── db.mjs                         # ⭐ SQLite 持久化层
│   ├── i18n.mjs                       # 国际化引擎
│   ├── llm/                           # 10 个 LLM 提供商
│   │   ├── index.mjs                  # 工厂函数
│   │   ├── copilot.mjs                # ⭐ Azure OpenAI / Copilot
│   │   └── ... (9 more)
│   ├── delta/                         # 增量检测引擎
│   │   ├── engine.mjs                 # 阈值/信号检测
│   │   └── memory.mjs                 # 半年滚动存储
│   └── alerts/
│       ├── telegram.mjs               # Telegram Bot + Webhook
│       └── discord.mjs                # Discord 告警
├── dashboard/
│   ├── inject.mjs                     # 数据聚合（raw → UI 结构）
│   └── public/
│       ├── jarvis.html                # 主仪表板（~2800 行单文件）
│       ├── about.html                 # 关于页
│       └── loading.html               # 加载页
├── locales/                           # 国际化文件
│   ├── zh.json                        # 简体中文
│   ├── en.json                        # 英文
│   └── fr.json                        # 法文
├── scripts/clean.mjs                  # 缓存清理脚本
├── server.mjs                         # Express 服务器 + SSE + Sweep 循环
├── crucix.config.mjs                  # 统一配置入口
├── diag.mjs                           # 环境诊断工具
├── package.json                       # 依赖 & 脚本
├── .env.example                       # 环境变量模板
├── Dockerfile                         # 容器镜像
├── docker-compose.yml                 # Docker 编排
├── LICENSE                            # AGPL-3.0
└── 未完成修复清单.txt                  # 开发进度追踪
```

---

## 🔮 还能加哪些 API

以下是可以进一步集成的公开数据源方向，按类别分组：

### 🌏 中国/亚太增强

| 类型 | 推荐 API | 说明 |
|:-----|:---------|:-----|
| A 股实时 | 东方财富行情 API | 沪深港通实时行情 |
| 期货市场 | 上期所/大商所/郑商所公开数据 | 国内期货行情 |
| 宏观数据 | 国家统计局 API | CPI/PPI/PMI 等 |
| 外汇 | 中国外汇交易中心 | 人民币汇率中间价 |
| 港股 | HKEX 数据 | 港股通/沪港深通 |
| 台海 | NOTAM 空域通告 | 航行通告追踪 |

### 🛡️ 安全与情报

| 类型 | 推荐 API | 说明 |
|:-----|:---------|:-----|
| 恶意 IP | AbuseIPDB API | IP 信誉查询（免费 1000 查/天） |
| 威胁情报 | AlienVault OTX | 开放威胁交换（免费） |
| 域名情报 | VirusTotal API | 恶意域名/文件检测（免费 500 查/天） |
| 暗网监控 | IntelX API | 数据泄露搜索 |
| C2 检测 | URLhaus (abuse.ch) | 恶意 URL 数据库（完全免费） |
| 钓鱼检测 | PhishTank API | 钓鱼 URL 数据库（免费） |

### 📊 经济与金融

| 类型 | 推荐 API | 说明 |
|:-----|:---------|:-----|
| 加密货币 | CoinGecko API | 加密行情（免费 30 调/分） |
| 外汇汇率 | ExchangeRate-API | 汇率数据（免费 1500 调/月） |
| 金属价格 | metals-api.com | 贵金属实时价格 |
| SEC 文件 | EDGAR Full-Text Search | 美国证券交易委员会文件 |
| 破产追踪 | PACER API | 法院破产文件 |

### 🌍 环境与气象

| 类型 | 推荐 API | 说明 |
|:-----|:---------|:-----|
| 全球气象 | Open-Meteo API | 全球天气（完全免费） |
| 空气质量 | OpenAQ API | 全球空气质量（免费） |
| 海洋监测 | Copernicus Marine API | 海洋温度/洋流（免费注册） |
| 火山活动 | GVP (Smithsonian) | 全球火山活动监测 |

### 📡 通信与基础设施

| 类型 | 推荐 API | 说明 |
|:-----|:---------|:-----|
| 海底光缆 | TeleGeography 数据 | 全球海底光缆地图 |
| BGP 路由 | RIPE Stat API | BGP 路由异常检测（完全免费） |
| DNS 监测 | Farsight DNSDB | 被动 DNS 数据 |
| 太阳活动 | NOAA SWPC API | 太阳风暴/地磁暴（免费） |

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────┐
│                  浏览器 (jarvis.html)             │
│  ┌───────┐ ┌──────┐ ┌───────┐ ┌──────┐         │
│  │ 新闻  │ │ 市场 │ │ OSINT │ │ 观点 │  ← 标签页 │
│  └───┬───┘ └──┬───┘ └───┬───┘ └──┬───┘         │
│      └────────┴─────────┴────────┘              │
│               SSE + /api/data 轮询               │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              Express 服务器 (:3117)              │
│                  server.mjs                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ Sweep 循环│  │ Delta 引擎│  │ Alert 推送    │ │
│  │ (15 min) │  │ (阈值检测)│  │ (TG/Discord) │ │
│  └────┬─────┘  └──────────┘  └───────────────┘ │
│       │                                          │
│  ┌────▼────────────────┐  ┌──────────────────┐  │
│  │  inject.mjs (聚合)  │  │  db.mjs (SQLite) │  │
│  └────┬────────────────┘  └──────────────────┘  │
│       │                                          │
│  ┌────▼────────────────────────────────────┐    │
│  │         briefing.mjs (源编排)            │    │
│  │   39 源并行 · 30s 超时 · 错误隔离        │    │
│  └────┬────────────────────────────────────┘    │
└───────┼─────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────┐
│              39 个 OSINT 数据源                   │
│  GDELT · OpenSky · FIRMS · ACLED · FRED · ...   │
│  CLS-Telegraph · Hot-News · CN-Finance-RSS · ... │
└─────────────────────────────────────────────────┘
```

---

## ⚠️ 非官方声明

- 本仓库**不是上游 [calesthio/Crucix](https://github.com/calesthio/Crucix) 的官方发行版**
- 不代表上游维护者的默认配置、运营立场或正式分发渠道
- 本仓库明确保留对上游仓库的引用和跳转链接
- 如上游维护者、素材权利人或其他相关权利方要求删除、替换或调整特定内容，本分支将尽快处理

## 📜 许可协议

本项目沿用上游 AGPL-3.0 许可证，详见 [LICENSE](LICENSE)。
