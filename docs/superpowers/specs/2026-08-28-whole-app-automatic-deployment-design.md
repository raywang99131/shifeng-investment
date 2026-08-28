# Shifeng Investment 整站自动部署设计

## 目标

在当前开发电脑修改 `shifeng-investment`，提交并合并到 GitHub `main` 后，GitHub Actions 自动构建整站发布包，并由带有 `shifeng-prod` 标签的常开电脑自动部署。发布范围同时包含前端、Node/Express 后端、Python 脚本和项目配置；Cloudflare Tunnel 继续只负责把 `www.shifeng-investment.com` 转发到常开电脑的 `localhost:3000`。

成功标准：

- `main` 每次更新都会触发一次生产构建和部署。
- 常开电脑不需要保存或手工维护 Git 工作副本，只保存可运行的发布副本。
- 新版本不得覆盖新闻、基金、日历、交易拥挤度、AI 看板、研究报告、价格追踪和量化缓存等运行数据。
- 新版本健康检查失败时自动恢复到上一版本。
- 发布流程不读取、上传或覆盖 Cloudflare Tunnel token、服务端环境变量和其他密钥。
- 部署成功后 `/api/build-meta` 能返回本次提交 SHA，便于确认线上是否已经更新。

## 已选方案

采用“GitHub 托管构建 + 自托管生产部署”两阶段方案。

1. GitHub 托管 runner 从 `main` 检出代码，用 Node.js 24 执行 `npm ci` 和 `npm run build`。
2. 构建任务将 Git 跟踪的应用代码、`dist` 前端产物和 `dist/build-meta.json` 打成发布包，并生成 SHA-256 校验值。
3. GitHub 保存短期 artifact，然后将部署任务派发给 `[self-hosted, shifeng-prod]` runner。
4. 常开电脑校验发布包后，将它解压到独立版本目录，安装仅生产环境需要的 Node 依赖，接入共享运行数据，切换 `current` 软链接并重启 Node 服务。
5. 部署脚本检查 `/api/health` 和 `/api/build-meta`。检查失败时把 `current` 恢复到上一个版本并再次启动。

未采用的方案：常开电脑直接 `git pull`。该方案会让代码工作区、构建产物和运行数据混在一起，容易因脏文件导致更新失败，也不便于可靠回滚。Cloudflare Pages/Workers 也不适合当前依赖本地文件、Python 脚本和常驻 Express 进程的应用。

## GitHub Actions 工作流

新增一个生产部署工作流：

- 触发条件：推送到 `main`，并允许从 GitHub 页面手动重跑。
- 权限：只授予 `contents: read`。
- 并发：同一生产部署组串行执行，避免两个发布同时切换版本。
- 构建环境：GitHub 托管的 Ubuntu runner，Node.js 24，使用 npm 缓存。
- 构建验证：至少执行发布脚本测试、`npm ci` 和 `npm run build`。
- 发布包：只包含 Git 跟踪的代码和构建生成的 `dist`；不包含 `.git`、`node_modules`、本地 `.env`、Tunnel token、日志、缓存或未跟踪运行数据。
- 部署环境：精确匹配 `[self-hosted, shifeng-prod]`，因此不会在普通 GitHub runner 或其他电脑上执行生产部署。
- artifact 保留期：7 天，便于短期诊断，不作为长期备份。

工作流文件自身与应用代码一同进入 GitHub；只有合并到 `main` 后才会开始生产部署。

## 常开电脑目录

默认部署根目录为 `$HOME/services/shifeng-investment`，可用 `SHIFENG_DEPLOY_ROOT` 覆盖。它不放在 Desktop 或 Documents 下，避免 macOS 后台服务受到这些目录的隐私权限限制。

目录结构：

```text
$HOME/services/shifeng-investment/
├── current -> releases/<git-sha>/
├── releases/
│   ├── <previous-sha>/
│   └── <new-sha>/
├── shared/
│   ├── runtime/...
│   └── logs/
└── deploy.lock
```

每个 `releases/<git-sha>` 都是完整、不可原地修改的应用发布副本。部署成功后保留当前版本和最近两个历史版本，其余历史版本才可清理。`shared` 不随发布删除。

## 运行数据保护

部署脚本通过仓库内的持久化路径清单管理运行数据。第一版清单覆盖：

- `server/data/calendar/events.json`
- `server/data/funds.json`
- `server/data/news.json`
- `server/data/macd_cache.json`
- `server/data/price-tracking/`
- `server/data/python-venv/`
- `server/data/quant/`
- `server/data/research/`
- `server/data/tmt-margin/`
- `server/data/ai-dashboard/`
- `server/data/tungsten-price-history.json`
- `server/data/x-followers.json`
- `server/public/reports/`
- `server/price_tracking/price_summarized_optimized.xlsx`
- `server/price_tracking/.price_summarized_optimized.last-good.xlsx`
- `server/price_tracking/price_summarized_optimized.akshare_update_log.csv`

对于每个路径，首次部署会优先从常开电脑 `$HOME/.config/shifeng-investment/deploy.env` 中明确配置的 `SHIFENG_LEGACY_ROOT` 迁移已有数据；没有配置旧部署或旧路径不存在时，才使用发布包内的种子数据或创建空目录。随后每个版本都用软链接连接到 `shared/runtime` 中的同一路径。部署脚本拒绝清单中的绝对路径和 `..` 路径，避免错误链接到项目外部位置。

`$HOME/.config/shifeng-investment/server.env` 保存服务端环境变量，`$HOME/.config/shifeng-investment/deploy.env` 保存部署机器路径配置；二者都不会进入 GitHub artifact。Cloudflare Tunnel 配置继续由 Tunnel 自己的服务和配置文件管理，不纳入应用发布。

## 服务启动与切换

Node 服务由 macOS LaunchAgent `com.shifeng-investment.server` 管理：

- 工作目录固定指向 `$HOME/services/shifeng-investment/current`。
- 启动命令为 Node.js 运行 `server/index.js`，监听 `127.0.0.1:3000`。
- 服务读取外部 `server.env`，并将标准输出和错误写入 `shared/logs`。
- `KeepAlive` 和 `RunAtLoad` 保证进程退出或电脑重启后恢复。
- Cloudflare Tunnel 是独立服务；应用部署只重启 Node 服务，不重启 Tunnel。

部署切换顺序：

1. 获取部署锁，防止并行发布。
2. 校验 artifact SHA-256 和目标提交 SHA。
3. 解压到新的临时目录并执行 `npm ci --omit=dev`。
4. 建立全部共享运行数据链接。
5. 将临时目录改名为 `releases/<git-sha>`。
6. 记录旧 `current`，原子切换 `current` 到新版本。
7. 让 launchd 重启 Node 服务。
8. 在限定时间内轮询 `/api/health`，随后检查 `/api/build-meta` 的 Git SHA。
9. 成功后清理多余旧版本；失败则恢复旧链接并重启旧服务。

首次部署没有旧版本且启动失败时，脚本保留失败目录和日志并以非零状态退出，方便 GitHub Actions 标记失败。

## 首次安装与日常使用

常开电脑只需要一次性满足：

- GitHub self-hosted runner 在线并带 `shifeng-prod` 标签。
- Node.js 24 和 npm 可从 runner 的 PATH 使用。
- runner 用户可以写入 `$HOME/services` 和 `$HOME/Library/LaunchAgents`，并可以操作自己的 `gui/<uid>` launchd 域。
- Cloudflare Tunnel 独立运行并把域名转发到 `http://localhost:3000`。
- 如果要继承常开电脑现有网站的运行数据，在 `deploy.env` 中把 `SHIFENG_LEGACY_ROOT` 设置为现有网站目录；这只是首次迁移使用。

第一次工作流运行会创建部署目录和 Node LaunchAgent。之后的日常流程只有：当前电脑改代码、提交/推送、合并到 `main`。不需要在常开电脑执行 `git pull` 或手工复制代码。

## 错误处理与可观察性

- 下载损坏、校验值不符、Node/npm 缺失、依赖安装失败或共享数据链接失败时，在切换 `current` 前退出，线上旧版本保持运行。
- 切换后健康检查失败时自动回滚，并把 GitHub Actions job 标记为失败。
- 部署日志同时出现在 GitHub Actions 和常开电脑 `shared/logs`。
- `dist/build-meta.json` 包含完整提交 SHA、构建时间和 GitHub run ID；线上可通过 `/api/build-meta` 查看。
- 工作流输出当前发布 SHA、前一版本 SHA和最终健康检查结果，但不得打印环境变量或 token。

## 安全边界

- self-hosted runner 只用于此私有仓库；不运行来自未受信任 fork 的生产部署代码。
- 工作流不使用 Cloudflare API token。Tunnel 凭据只存在于常开电脑。
- 不把 `.env`、`server.env`、Tunnel token、GitHub runner 注册 token 或用户运行数据上传为 artifact。
- 部署脚本只删除部署根目录下已经验证名称的旧 release，不递归删除宽泛路径。
- 所有外部路径都先规范化并验证位于部署根目录内。

## 测试策略

实现时先为部署脚本写失败测试，再补最小实现。自动测试必须覆盖：

- 发布包包含后端、Python 脚本和前端 `dist`，排除密钥与运行数据。
- 持久化清单中的文件和目录在新旧版本之间保持不变。
- 非法持久化路径被拒绝。
- 成功发布切换 `current` 并保留最近三个版本。
- 依赖安装或健康检查失败不会破坏当前版本。
- 切换后健康检查失败能恢复上一版本。
- build metadata 的提交 SHA 必须与工作流输入一致。
- 工作流仅对 `main` 自动触发，部署 job 必须包含 `self-hosted` 和 `shifeng-prod` 标签。

本地测试使用临时目录和假的服务控制命令，不操作真实 launchd、真实 Tunnel 或 `$HOME/services`。完成后还需在常开电脑执行一次首次发布，并通过本地健康检查和域名访问验证。

## 不在本次范围内

- 不把 Cloudflare Tunnel 改造成代码托管或构建平台。
- 不迁移到 Cloudflare Workers/Pages。
- 不自动提交当前电脑尚未确认的未提交文件。
- 不把运行数据同步回 GitHub。
- 不管理仓库之外的 ETF monitor 或其他独立服务。
