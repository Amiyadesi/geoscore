# GeoScore - 证据优先的 SEO 与 GEO 审计

[English README](./README.md) · 中文

<p align="center">
  <a href="https://geo.sayori.org">
    <img src="https://geo.sayori.org/og-image.svg" alt="GeoScore - 免费 SEO 与 GEO 审计" width="100%"/>
  </a>
</p>

GeoScore 是一个开源、证据优先的 SEO / GEO 审计服务，运行在 Cloudflare
Workers、Pages、D1、KV、Vectorize 和 Workers AI 上，也可以接入可选的公共证据源。
它区分“已经观察到的事实”“无法验证的内容”和“值得优先修复的失败项”，不把缺失证据伪装成 0 分。

**在线体验：[geo.sayori.org](https://geo.sayori.org)**  
**使用文档：[geo.sayori.org/docs](https://geo.sayori.org/docs)**  
**OpenAPI：[geo-api.sayori.org/openapi.json](https://geo-api.sayori.org/openapi.json)**  
**示例：[Stripe 审计](https://geo.sayori.org/?d=stripe.com)**

## LINUX DO 社区致谢

GeoScore 感谢 [LINUX DO 社区](https://linux.do/) 对开源讨论、实践反馈和项目传播的支持。
社区推广帖应链接回本仓库，方便读者查看完整源码、许可证和审计边界。

## GeoScore 审计什么

GeoScore 2.4.5 有两种模式：

- `site` 模式建立站点画像，并确定性抽样最多五个 HTML 页面：首页、可发现的 About 页面，以及代表性页面类型。
- `url` 模式审计指定 URL；目标不是首页时，必要时额外读取首页建立上下文。

站点类型优先依据 JSON-LD、标题、canonical、导航和页面结构识别，而不是简单累加正文关键词。
个人博客不会因为文章里出现“AI”“Cloudflare”或“服务”就被强行判成 SaaS。

匿名审计公开 60 项事实检查，其中 54 项参与评分，6 项提供信息；另有一个权重为 0 的
`Predicted` 可见性模拟。实时检查数量以 `/api/meta` 为准。

| 范围 | 证据 |
| --- | --- |
| 发现与传输 | HTTP 状态、HTTPS、可索引性、robots.txt、sitemap、canonical、语言、hreflang、响应时间、压缩、HTML 体积、DOM 规模、阻塞脚本和响应头 |
| 页面语义 | title、description、H1 与标题层级、内链、Open Graph、图片 alt/尺寸/响应式候选、跨页面标题一致性 |
| 结构化数据与画像 | schema 是否存在、schema 是否适合站点类型、站点类型、实体、商业模式、语言、根域、页面角色、置信度和原始证据 |
| 移动与无障碍 | viewport、基础移动体验、表单标签、landmark、描述性链接、跳过导航和图片可访问性 |
| 性能 | CrUX 字段数据及 PageSpeed/Lighthouse 实验室数据；成功数据会合并回审计并重新计算同一份报告 |
| 事实 GEO Readiness | 实体一致性、文章级内容责任归属、正文可提取性、适用时的直接回答结构、声明与来源关联、统计来源、时效性、来源链接和跨页面一致性 |
| 公共发现证据 | HTML 规范校验、RSS/Atom、AI crawler policy、llms.txt、域名匹配的知识图谱证据和 Common Crawl 捕获记录 |

每份报告展示 3 个有证据的优先行动。主下载按钮生成一个确定性的
`GEOSCORE-REPAIR-<domain>.md`，包含全部失败、unknown/error 证据、不适用与信息项、分数封顶原因、
复验步骤，以及内容 AI 简报和开发 AI 简报。内容简报只收录适用且已失败的内容检查，用于让外部 AI
提出受证据约束的候选修改；开发简报收录 metadata、schema、抓取、性能及其他代码或配置任务。
下载本身不调用 AI，不生成整篇替换文章，也不会自动发布；单项 AI FixPack 仍只是已存储失败项的可选高级详情。

内容责任归属只检查抽样到的文章页。首页、文档页、产品页、分类页、联系页和普通作品集页面不会为了分数被要求添加作者。
个人博客可以复用可信的站点级 `Person` 身份；编辑出版物或新闻文章可以标明真实作者或责任发布方。

### Evidence Map 与免账号监控

Evidence Map 会把一份已完成审计转换为最多 3 条有界查询。受保护的 Search Gateway
可为每条查询采集最多 2 个搜索 provider 的带日期证据；另可调用 1 个 answer provider
生成明确标注的 API answer snapshot。这些结果属于来源证据，不代表真实消费端产品已经引用该站点，
也不会改变事实 SEO/GEO 主分。

监控无需注册账号。创建项目时只返回一次高熵管理 token；D1 仅保存带版本、pepper 的 HMAC
和短提示。每个项目按周运行，最多保留 12 个真实 snapshot。BYOK 只会在本次请求中转发给
一次 answer 请求，不写入 D1、KV、URL、报告或前端持久化状态。

邮件提醒要求先验证邮箱。首次 baseline、评分版本变化、coverage/confidence 不足时不会比较。
当可比较的事实分发生非零变化时，系统会先保存 run、dated snapshot 与 baseline，再调用主邮件通道，
最后独立回写邮件结果，因此邮件服务失败不会丢失一次已经完成的监控运行。项目持有者可通过
run 级提醒接口重试失败邮件，后端会继续使用同一 run ID 作为主 provider 幂等键。鉴权、限流、网络
或上游故障时，可以切换到服务端固定发件 `/v1/messages` 备用通道；参数被拒绝时不会盲目重试。

### 评分原则

分数只使用“已知且适用”的 `pass` / `fail` 检查。`unknown`、provider error 和
`not_applicable` 不会偷偷变成扣分或 0 分。严重、主要和次要失败会触发封顶；重复出现的 critical 或 major
失败会按数量继续降低上限，但不会改变检查权重。coverage 或 confidence
不足时，总分可以是 `null`，报告会明确显示证据不足。

`Predicted visibility` 只表示基于主题和查询机会的模拟，不代表 ChatGPT、Perplexity 或 Google AI
Overview 的真实引用结果，也不影响 SEO、GEO 或 overall 主分。

### 保留但不进入匿名热路径的模块

仓库仍保留关键词生成、AI 内容洞察、站外 SEO/反链、完整站点情报、重定向链、安全审计、SSL/域名情报和坏链扫描等上游或旧模块。
GeoScore 2.4.5 会将它们标为 `skipped`，不把它们放入评分分母，也不会把未收集的证据报告成通过。

## 架构

```text
Cloudflare Pages (frontend/*)
        | REST + SSE
Cloudflare Worker (src/index.ts)
        |-- D1: 审计与历史
        |-- KV: 缓存、限流和预算
        |-- Vectorize: 可选向量证据
        |-- Workers AI: 可选模型辅助
```

## 快速部署

### 前置条件

- [Cloudflare 账号](https://dash.cloudflare.com/sign-up)，免费计划可运行基础版本
- [Node.js](https://nodejs.org/) 18+
- [Git](https://git-scm.com/)

GitHub Actions 部署需要一枚只属于目标 Cloudflare account 的 API token。工作流会在修改资源前检查
D1、Workers KV、Vectorize、Workers Scripts 和 Cloudflare Pages 权限。将它保存为
`GEOSCORE_CF_API_TOKEN`，账号 ID 保存为 `GEOSCORE_CF_ACCOUNT_ID`；不要写入源码、README、日志或前端。

### 安装与登录

```bash
git clone https://github.com/YOUR_USERNAME/geoscore.git
cd geoscore
npm install
npx wrangler login
```

### 准备资源与迁移

```bash
npm run prepare:cloudflare
npm run db:migrate:local
npm run db:migrate
```

`prepare:cloudflare` 会发现或创建命名资源，并把 ID 写入被 `.gitignore` 排除的
`wrangler.generated.jsonc`。分叉项目需要先修改 `wrangler.jsonc` 中的公开 URL 和 `NOMINATIM_USER_AGENT`。

### 部署

```bash
npm run deploy
npm run deploy:pages
```

前端 API 地址位于 `frontend/app.js` 的 `PRODUCTION_API`。部署分叉时改成你自己的 Worker URL。

### 本地开发

```bash
npm run dev
```

默认本地 Worker 地址为 `http://127.0.0.1:8787`。需要测试远程 Browser Run binding 时，显式使用：

```bash
npx wrangler dev --config wrangler.jsonc --remote
```

这会消耗 Cloudflare Browser Run 配额，不建议作为日常测试命令。

部署前运行本地验证：

```bash
npm run check
npm test
npm run test:e2e:install
npm run test:e2e
```

Playwright 使用固定 API fixture，覆盖中英文桌面端和移动端流程，不消耗线上审计或 Browser Run 配额。

## 可选服务

### Browser Run

普通 HTTP 抓取遇到 bot challenge、JS 空壳或可重试网络错误时，Worker 可以进行一次受预算限制的 Browser Run 尝试。
它使用 `wrangler.jsonc` 中的 `BROWSER` binding，不需要把 Browser Rendering REST token 放进 Worker secret。
20 秒尝试预算会分配给页面导航、加载后的短暂渲染等待和 HTML 捕获。GeoScore 等待 `load` 事件，不再等待后台网络完全空闲，避免分析脚本和持续请求拖满整次尝试，同时仍给普通 hydration 留出确定的完成时间。

### Search Gateway / SearXNG

关键词研究可选调用受保护的 Search Gateway，生成主题簇和内容机会；搜索结果不是 AI 引用监控。

```toml
SEARCH_GATEWAY_URL = "https://search.sayori.org"
```

```bash
npx wrangler secret put SEARCH_GATEWAY_API_KEY --config wrangler.generated.jsonc
```

也支持直接配置 `SEARXNG_URL`。两个地址或 secret 为空时，审计仍可运行，只跳过搜索增强。

### 免账号证据监控与邮件提醒

监控会基于最近一份兼容的已完成审计，按周采集带日期的 Evidence Map snapshot；它不会宣称
重新执行了全部审计模块，也不会把 API answer snapshot 描述成消费端 AI 产品的真实引用。
先生成至少 32 个字符的私有 pepper，再按需配置主邮件通道与固定发件备用通道：

```bash
npx wrangler secret put MONITOR_TOKEN_PEPPER --config wrangler.generated.jsonc
npx wrangler secret put RESEND_API_KEY --config wrangler.generated.jsonc
npx wrangler secret put CF_TEMP_MAIL_BASE_URL --config wrangler.generated.jsonc
npx wrangler secret put CF_TEMP_MAIL_SEND_API_KEY --config wrangler.generated.jsonc
```

Worker 不配置 inbox API key，创建与读取临时收件箱只用于本地授权测试。

GitHub Actions 会把 `GEOSCORE_MONITOR_TOKEN_PEPPER` 映射为 Worker secret
`MONITOR_TOKEN_PEPPER`。一次性管理 token 丢失后无法从数据库恢复；应在旧 token 仍可用时轮换，
否则重新创建监控项目。

### 外部 LLM fallback

确定性检查和建议模板始终是权威结果。外部模型只用于可选的修复说明扩展；一次请求最多访问一个外部入口，失败不会级联消耗多个额度。

```bash
npx wrangler secret put API_KEY --config wrangler.generated.jsonc
npx wrangler secret put API_BASE_URL --config wrangler.generated.jsonc
npx wrangler secret put API_MODEL --config wrangler.generated.jsonc
npx wrangler secret put GROQ_API_KEY --config wrangler.generated.jsonc
npx wrangler secret put OPENROUTER_API_KEY --config wrangler.generated.jsonc
```

这些 key 只应存在于 Worker secret 或 GitHub Actions secret，不应进入 tracked files、前端状态或公开报告。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `NOMINATIM_USER_AGENT` | 是 | OpenStreetMap 地理编码的应用名和联系信息 |
| `SEARCH_GATEWAY_URL` | 否 | 受保护的 Search Gateway 地址 |
| `SEARXNG_URL` | 否 | SearXNG fallback 地址 |
| `DAILY_BROWSER_BUDGET_SECONDS` | 否 | Browser Run 每日预算 |
| `ADMIN_TOKEN` | 生产建议 | 管理/诊断端点保护 token |
| `GOOGLE_API_KEY` | 否 | Chrome UX Report API key |
| `PAGESPEED_API_KEY` | 否 | PageSpeed Insights / Lighthouse API key |
| `OPENPAGERANK_KEY` | 否 | OpenPageRank authority 数据 |
| `RESEND_API_KEY` | 否 | 每周监控邮件 |
| `CF_TEMP_MAIL_BASE_URL` | 配合备用邮件 | 固定发件服务的 HTTPS 根地址，后端自动补 `/v1/messages` |
| `CF_TEMP_MAIL_SEND_API_KEY` | 配合备用邮件 | 仅服务端使用的固定发件 key，不要把 inbox API key 配进 Worker |
| `SEARCH_GATEWAY_API_KEY` | 否 | 发给 Search Gateway 的 `X-API-Key` |
| `MONITOR_TOKEN_PEPPER` | 使用监控时必填 | 至少 32 个字符；在管理 token 与邮箱验证 token 写入 D1 前用于 HMAC |
| `API_KEY` | 否 | 通用外部 LLM fallback，仅 Worker 使用 |
| `API_BASE_URL` | 配合 `API_KEY` | OpenAI-compatible base URL |
| `API_MODEL` | 配合 `API_KEY` | 通用模型 ID |
| `GROQ_API_KEY` | 否 | 主要外部 LLM 入口，非权威证据 |
| `OPENROUTER_API_KEY` | 否 | reserve 外部 LLM 入口 |

需要 billing、OAuth、站点所有权或人工申请的服务见
[docs/manual-service-actions.md](./docs/manual-service-actions.md)。

## 项目结构

```text
geoscore/
├── frontend/       # Cloudflare Pages 前端
├── src/             # Worker、审计核心、模块和路由
├── migrations/      # D1 migrations
├── scripts/         # 资源准备、部署和 smoke test
├── tests/           # 单元、契约和 fixture 测试
└── wrangler.jsonc   # Worker 配置模板
```

## Cloudflare 使用边界

抓取、Browser Run、subrequest 和模型调用都受预算限制，以适配低成本 Cloudflare 计划。
Cloudflare 限额会变化，请以官方文档为准。可选 provider 失败时返回结构化 unknown/error，不决定事实分数。

## 许可证与上游致谢

本项目使用 MIT 许可证，见 [LICENSE](./LICENSE) 和
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。项目基于并改进
[`sprawf/geoscore`](https://github.com/sprawf/geoscore)。再次感谢
[LINUX DO 社区](https://linux.do/) 的开源交流与反馈。
