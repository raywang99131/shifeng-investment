# 石锋投资平台仓库结构清理设计

## 背景

仓库已经从单一 React 页面演进为包含 React/Vite 前端、Node/Express API、Cloudflare Worker、Python 行情服务、研究自动化任务和本地数据任务的多运行时项目。当前目录仍保留早期单容器、三容器、Railway、本地 Tunnel 和 Cloudflare 等多套部署痕迹，根目录职责不清，部分运行时产物也仍被 Git 跟踪。

本次工作采用分阶段迁移，不在一个提交中同时移动全部模块。每个阶段必须保持现有公开 URL、API 路径、命令入口和数据口径不变，并能独立回滚。

## 目标

1. 让前端、后端服务、后台任务和部署配置有清晰边界。
2. 删除可以证明无效或不应纳入版本控制的文件。
3. 保持 Cloudflare 网站、GitHub Actions 研究任务和本地 Node API 的现有行为。
4. 让新开发者能从 README 看懂每个运行单元如何开发、测试和部署。
5. 用自动化结构检查阻止缓存、运行产物和退役配置重新进入仓库。

## 非目标

- 不改变投资数据、新闻、研报、AI 看板或量化策略的业务逻辑。
- 不改变现有 HTTP API 路径和前端路由。
- 不在本次结构重组中升级 React、Express、Vite、Wrangler 或 Python 依赖。
- 不把所有 Node 与 Python 服务强行合并为一个进程或容器。
- 不删除仍可能作为灾备入口使用的统一 `Dockerfile`，除非外部部署状态已经单独确认。

## 当前运行单元

| 单元 | 当前位置 | 当前职责 |
| --- | --- | --- |
| Web 前端 | `src/`、`public/`、`index.html` | React/Vite 单页应用 |
| 本地 API | `server/`、根 `index.js` | Express API、静态页面、本地定时任务 |
| Cloudflare 边缘层 | `worker/`、`wrangler.jsonc` | 网站静态资源、研究 API、旧 API 代理 |
| 行情服务 | `quote_service/` | Python 行情查询服务 |
| 研究自动化 | `automation/research-tasks/` | GitHub Actions 调用的 Python 研报任务 |
| 市场数据任务 | `macd screener/`、`scripts/`、`server/price_tracking/` | MACD、拥挤度、价格和回填任务 |
| 其他边缘代码 | `cloudflare/`、`functions/` | 独立收集器和早期函数代码 |

## 目标目录

```text
shifeng-investment/
├── frontend/
│   ├── src/
│   ├── public/
│   └── index.html
├── backend/
│   ├── api/                  # Node/Express API
│   ├── worker/               # Cloudflare 网站和研究 API
│   ├── services/
│   │   └── quote/            # Python 行情服务
│   ├── jobs/
│   │   ├── research/         # 公告和研报自动化
│   │   ├── market-data/      # MACD、TMT、行情回填
│   │   └── price-tracking/   # 大宗商品价格任务
│   └── serverless/           # 仍有调用方的独立函数
├── infrastructure/
│   ├── cloudflare/
│   └── docker/
├── scripts/                  # 只保留仓库级开发、校验、发布脚本
├── docs/
├── package.json              # 迁移期统一命令入口
└── README.md
```

`.github/`、Git 配置、根 `package.json` 和根 TypeScript/测试配置继续位于仓库根目录，因为工具链要求或统一命令入口需要它们。目录分层表达职责边界，不追求把所有配置机械地塞进 `frontend/` 或 `backend/`。

## 迁移策略

### 波次一：安全清理和边界护栏

先完成不会改变运行路径的清理：

- 删除已被 Git 跟踪的 `quote_service/**/__pycache__/*.pyc`。
- 删除已经无法从干净检出构建的三容器遗留链：`docker-compose.yml`、`Dockerfile.server`、`Dockerfile.web` 和只服务该链的 `nginx.conf`。当前 Compose 引用了不存在的 `quote_service/Dockerfile`，Web 镜像又依赖未被 Git 跟踪的预构建 `dist/`。
- 暂时保留根 `Dockerfile` 和 `railway.json`；它们不参与当前 Cloudflare 部署，但可能仍被外部平台自动探测，后续需在确认外部服务后单独退役或修复。
- 新增仓库结构测试，禁止跟踪 `__pycache__`、`.pyc`、`dist/`、`node_modules/` 和上述退役的 Compose 文件。
- 为现有 Node、Worker、构建测试增加统一的根命令，确保后续移动目录时有单一回归入口。
- 在 README 增加“运行单元与部署边界”，明确 GitHub 代码本身不等于已配置可运行环境。

波次一不删除业务快照。虽然 `server/data/ai-dashboard/snapshot.json`、Excel 和新闻 JSON 会污染工作区，但它们同时承担离线回退或种子数据职责，必须在波次三完成数据分类后再决定去留。

### 波次二：前端迁移

- 将 `src/`、`public/`、`index.html` 移入 `frontend/`。
- 调整 Vite、TypeScript、ESLint 和前端测试路径，但保留根命令 `npm run dev`、`npm run build` 和 `npm run preview`。
- 构建产物仍输出到根 `dist/`，避免改变 Wrangler 资产绑定和本地 Express 静态目录。
- 不修改页面路由、API URL 或浏览器存储键。

### 波次三：后端迁移与数据分类

- 将 `server/` 移入 `backend/api/`，根 `index.js` 的环境加载职责合并到明确的 API 启动入口；迁移期间允许保留一个薄兼容入口。
- 将 `worker/`、`quote_service/`、`automation/research-tasks/` 和 `macd screener/` 分别迁入目标后端子目录。
- 把 `server/price_tracking/` 与相关刷新脚本归入 `backend/jobs/price-tracking/`。
- 按“源数据/种子数据/测试夹具/运行产物”分类 `server/data/`：只有可审计的小型种子和确定性夹具留在 Git；变化频繁的快照进入 D1、R2 或被忽略的运行目录。
- 更新 GitHub Actions、Wrangler、Shell、Python、Node 子进程路径和文档中的路径引用。
- 将包含空格的 `macd screener` 目录更名为 `market-data`，避免 Shell 和部署脚本持续承担转义风险。

### 波次四：部署配置收敛

- 以 Cloudflare Worker + GitHub Actions + 本地 Legacy API 作为文档中的现行架构。
- 对根 `Dockerfile` 和 `railway.json` 做外部使用确认：仍使用则修成可复现的灾备部署并移入清晰的基础设施说明；未使用则删除。
- `cloudflare/` 和 `functions/` 逐项查找调用方：活跃代码迁入 `backend/worker/` 或 `backend/serverless/`，无调用方代码在测试证明后删除。
- 根目录最终只保留工具链规定文件、统一命令入口、文档和名称明确的一级职责目录。

## 兼容性约束

- 根命令名称保持不变；内部脚本路径可以调整。
- `dist/` 在完整迁移结束前仍位于仓库根目录。
- Cloudflare 的 Worker 名称、域名、D1 数据库、R2 Bucket 和 Secret 名称不变。
- GitHub Actions 的触发方式、上海时区日期语义和失败上报行为不变。
- Node API 默认端口、前端路由和 `/api/*` 路径不变。
- 不读取、复制或提交 `.env.local`、Tunnel Token、Cloudflare Secret 或 GitHub Token。

## 测试策略

每个波次至少运行：

1. 仓库结构测试，验证禁止文件和关键入口。
2. `npm run build`，验证 TypeScript 和 Vite 构建。
3. Node 测试集合，要求现有 239 项全部通过。
4. `npm run test:worker`，要求现有 38 项全部通过。
5. Python 单元测试，按被移动任务的 requirements 分组执行。
6. 使用干净文件清单检查 Docker/Cloudflare/GitHub Actions 路径，不依赖本地 `dist/`、缓存或未跟踪文件。

结构测试必须先失败再实施对应移动或删除，用测试锁定目录契约。纯文档和 Git 删除动作不新增业务逻辑测试，但必须由结构测试覆盖结果。

## 回滚与提交边界

- 每个波次独立提交；目录移动和业务修改不得混在同一提交。
- 使用 `git mv` 保存文件历史。
- 每次只迁移一个运行单元，路径修复与该单元同提交。
- 任一波次验证失败时停在当前波次修复，不继续叠加后续迁移。
- 原工作目录的未提交改动不纳入本分支；后续集成时通过正常合并解决冲突。

## 验收标准

- 仓库中不再跟踪 Python 缓存或已证明失效的三容器配置。
- README 能说明每个运行单元、依赖和部署位置。
- 前端与后端业务代码分别归入 `frontend/`、`backend/`，后端内部按运行时继续分层。
- 根目录不存在含糊的重复启动或部署入口。
- 构建、Node 测试、Worker 测试和相关 Python 测试全部通过。
- 在干净检出环境中，命令不依赖未跟踪文件即可运行。
