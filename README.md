<div align="center">

# Crucix 中文增强分支

[![上游仓库](https://img.shields.io/badge/Upstream-calesthio%2FCrucix-111827?style=for-the-badge&logo=github)](https://github.com/calesthio/Crucix)
[![分支定位](https://img.shields.io/badge/Branch-非官方中文增强版-0f766e?style=for-the-badge)](https://github.com/QianChang-official/crucix_zh_repir)
[![Node.js](https://img.shields.io/badge/Node-22%2B-22c55e?style=for-the-badge&logo=node.js&logoColor=white)](#快速启动)
[![License](https://img.shields.io/badge/License-AGPL--3.0-2563eb?style=for-the-badge)](LICENSE)

</div>

这是一个基于上游 Crucix 的非官方中文增强分支。核心目标很直接：让原本偏英文、偏全球公开情报视角的本地监控终端，在中文环境下更容易直接使用，并且补上国内新闻、财讯、中文来源映射、时间本地化、分页快讯流和轻量数据流图。

上游官方仓库： https://github.com/calesthio/Crucix

## 非官方说明

- 本仓库不是上游官方发行版。
- 本仓库不代表上游维护者的默认配置、运营立场或正式分发渠道。
- 本仓库明确保留对上游仓库的跳转，避免被误认为官方版本。
- 如果上游维护者、素材权利人或其他相关权利方要求删除、替换或调整特定内容，这个分支会尽快处理。

## 这个分支新增了什么

- 简体中文界面、中文术语和更多来源中文映射。
- 来源地时间、北京时间和更贴近真实发布时间的展示逻辑。
- 中国新闻聚合：接入中国新闻网、人民网、新华网、央视网、新浪新闻。
- 国内财讯/热榜补源：接入 orz-ai/hot_news，补充财联社、东方财富、雪球、新浪财经等热榜线索。
- 新闻同题聚类与冲突判断：识别同题多源聚合，以及“确认/否认”“上升/下降”类口径冲突。
- 全球快讯流、公开情报流改为分页模式，不再被固定条数卡死。
- 新闻卡片加入原文和机翻入口，不依赖浏览器翻译插件。
- 中国新闻数据流图：按来源、热度、新鲜度和时间桶做轻量可视化。
- 中港市场补强：加入上证、深证、沪深 300、恒生和中国主题 ETF。
- FRED 无 Key 时增加 fredgraph CSV fallback，减少宏观面板空窗。
- 可选接入 Flightera，用于机场延误观察。
- 重写 About 页面，单独说明当前分支与上游的关系。

## 现在能看到什么

- 全球快讯流：多源合并，按时间排序，支持分页和机翻。
- 中国新闻聚合：国内主流媒体 + 财讯热榜，同题归并并标记冲突。
- 中国新闻数据流：来源分布、近时段变化、同题数量、冲突数量、快讯热度。
- 宏观与市场：全球指数、中港指数、中国主题 ETF、商品、加密、宏观指标。
- 公开情报流：Telegram/WHO 等公开情报条目分页展示。
- 地球/平面地图：保留上游核心视觉，并兼顾低性能模式。

## 快速启动

```bash
# 1. 克隆仓库
git clone https://github.com/QianChang-official/crucix_zh_repir.git
cd crucix_zh_repir

# 2. 安装依赖
npm install

# 3. 复制环境变量模板
copy .env.example .env

# 4. 启动
npm run dev
```

默认地址： http://localhost:3117

如果你的终端里 `npm run dev` 没输出或直接退出，直接改用：

```bash
node --trace-warnings server.mjs
```

## 常用命令

```bash
npm run dev
npm run inject
npm run sweep
npm run diag
```

- npm run dev：启动服务。
- npm run inject：执行一次聚合并把数据写入页面。
- npm run sweep：单独跑数据抓取层。
- npm run diag：检查环境和依赖。

## 环境变量建议

优先推荐：

- FRED_API_KEY：宏观指标。
- EIA_API_KEY：能源数据。
- FIRMS_MAP_KEY：卫星火点数据。

可选增强：

- ACLED_EMAIL 和 ACLED_PASSWORD：冲突事件。
- TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID：Telegram 告警与命令。
- DISCORD_WEBHOOK_URL 或 DISCORD_BOT_TOKEN：Discord 告警。
- LLM_PROVIDER 和 LLM_API_KEY：AI 观点、告警增强。
- FLIGHTERA_RAPIDAPI_KEY：机场延误观察。
- FLIGHTERA_AIRPORTS：自定义监控机场，例如 ZBAA,ZSPD,VHHH。

## 中国新闻与热榜来源说明

当前分支已接入的中国新闻/财讯增强源包括：

- 中国新闻网 RSS
- 人民网 RSS
- 新华网页面抓取
- 央视网页面抓取
- 新浪新闻 JSON feed
- orz-ai/hot_news 公共接口

这些数据被用于：

- 中国新闻聚合面板
- 中国新闻数据流图
- 全球快讯流补充
- 跨源信号中的国内财讯线索

## Flightera 说明

Flightera 是可选能力，不配置 Key 也不会影响主站运行。

- 未配置时：页面会显示未启用状态，不会导致服务启动失败。
- 已配置时：宏观面板会出现机场延误观察摘要。

## 目录结构

- apis：各类数据源抓取与标准化。
- dashboard/inject.mjs：聚合层，把抓取结果整理成前端数据结构。
- dashboard/public/jarvis.html：主页面。
- dashboard/public/about.html：分支说明页。
- runs：运行时缓存和历史结果。

## 与上游的使用建议

如果你需要尽量接近官方默认行为、默认文档和默认布局，请直接使用上游仓库。

如果你需要：

- 中文界面
- 国内新闻和财讯补源
- 更强的中港市场观察
- 网页内直接机翻入口
- 中国新闻聚类、冲突判断和数据流图

那就用当前分支。

## 权利与引用声明

- 本仓库仅对开源项目进行本地化、聚合、界面增强与运行修复。
- 原始项目结构、思路和基础能力来自上游 Crucix。
- 本仓库不会自称为上游官方源。
- 如有侵权通知、素材异议、品牌使用异议，请直接提出，相关内容将尽快删除或调整。

## 许可协议

本项目沿用上游许可证，详见 [LICENSE](LICENSE)。