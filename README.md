# 石锋资产投研平台

## 公告监控云端版

公告研判、业绩预告、业绩报告和风险提示已经支持 GitHub Actions + Cloudflare Worker/D1/R2。网站打开时先显示缓存，再检查云端更新；电脑关机也不影响公告监控和定时任务。

完整部署、历史数据迁移和回滚方法见 [docs/cloud-research-deployment.md](docs/cloud-research-deployment.md)。原来的 Named Tunnel 只用于尚未云化的旧接口。

## AI 投资看板配置

AI 看板位于 `/ai-dashboard`，沿用网站现有访问边界，不再要求单独输入访问口令。ARR 与估值使用已核对的表格快照 `server/data/ai-dashboard/growth-reference.json`，同时保留已核验的公司官网历史 ARR。总览和 ARR 页共用 OpenAI、Anthropic 全历史图，每家公司一条线，数据点颜色区分来源，预测不进入历史图。月度区以亿美元计，Yipit 区以十亿美元计；读取时统一单位并重算日期和倍数公式，不使用 Excel 的零值公式缓存。历史 P/ARR 按月份使用同月或此前 ARR，原表的前瞻分母及公式假设另行标注。该文件是人工核对快照，刷新不会重新下载飞书或改变实际观测日期；后续需核对原表并更新该文件。价格、融资、官网模型卡、算力租赁等板块继续读取登记过的公开网页。

OpenRouter 数据来自[官网排行榜网页](https://openrouter.ai/rankings)，不调用 OpenRouter API，也不读取或发送 `OPENROUTER_API_KEY`。每次同步读取 HTML 中的 This Week 榜单，解析公开表格中的 Top 10 模型、Token 显示值、涨跌方向和 `Usage data through` 数据日期；统计窗口为截至该日期的七个完整 UTC 日。点击 OpenRouter 页签会同步一次，服务启动后和每日定时也会同步。

每周模型堆叠图读取 `server/data/ai-dashboard/openrouter-weekly-history.json`：2026-09-06 在浏览器打开官网图表，逐周读取 52 个可见悬浮提示，并从已渲染 SVG 保留模型颜色和堆叠顺序。周区间为周一至周日，包含每周前列模型与 Others；最后一周截至 2026-09-05 尚未完结，108T 为实际约数，116T 为 Weekly Pace 预计整周值，斜纹只画预计增量 7.54T。各分项与 Total 独立四舍五入，校验允许显示精度范围内的差异。

历史图不在页面 HTML 内，因此榜单刷新不会伪造历史图的更新日期。已校验的本地周图可在首次联网前读取，榜单联网失败不影响其展示。更新历史图时，需再次在浏览器逐周读取可见提示并替换该文件，保留 `asOf`、`capturedAt`、模型顺序及显示字符串，然后运行 OpenRouter 分片刷新。少于 52 周、缺周、重复模型、合计超出舍入误差等无效快照会被拒绝并保留旧图；榜单日期领先周图时，页面单独提示“周图待更新”。

`server/data/ai-dashboard/openrouter-public.json` 保存最近一次成功解析的网页结果，供核对来源，不再用旧文件冒充实时刷新。官网网页无法读取、表格不完整或日期倒退时保留上次成功快照，显示失败或过期状态。数量与模型周环比为官网约数；Top 10 合计仅覆盖这十个模型，网页表格未提供的全平台七日总量和对应周环比保持缺失，旧平台数据单独保留在 `archivedPlatformData` 供追溯。

仅刷新此分片：`npm run refresh:ai-dashboard -- --sources=openRouter`。

### Benchmark 数据边界

Benchmark 不使用 OpenRouter Benchmark API、飞书、Artificial Analysis、Design Arena 或其他公开测评机构补分。它只读取 12 家厂商控制的模型卡、系统卡、发布页、官方 GitHub/Hugging Face 组织：

- Anthropic：`anthropic.com/system-cards`
- OpenAI：`deploymentsafety.openai.com`
- Gemini：`deepmind.google/models/model-cards`
- 智谱：`docs.bigmodel.cn`
- MiniMax：`github.com/MiniMax-AI`
- Qwen：`huggingface.co/Qwen` 与 `github.com/QwenLM`
- MiMo：`github.com/XiaomiMiMo`
- DeepSeek：`github.com/deepseek-ai`
- Kimi：`github.com/MoonshotAI`
- Meta：`developer.meta.com/ai/models`
- Tencent：`github.com/Tencent-Hunyuan`
- xAI：`x.ai/news`

每家只展示当前确认的最新旗舰/通用文本模型。官网未披露分数时显示“未披露”，读取失败时仅保留该厂商上一版官网结果并标旧，不会拿旧模型或另一家数据顶替。同一测试名、版本、split、分数口径的披露合并到一个展示分项；同一模型存在多个运行配置时全部保留并标记歧义。Agent 类冠军要求 Agent、Harness、推理强度、shots/Pass@k 和工具策略逐字段一致；非 Agent 类仅在至少两家披露同一精确测试、未明确标注配置不完整且已披露配置不冲突时生成严格冠军。其他共享分项只显示“官网披露最高值 · 非严格横比”。Terminal-Bench 始终放在 Agent 类别首位，2.0、2.1、3.0 不合并。Fable 与 Mythos 不做名称排除。

进入 Benchmark 页签时会强制触发一次仅限官网模型卡的刷新；并发刷新会合并为同一个请求。所有公开来源每日检查一次，快照原子写入 `server/data/ai-dashboard/snapshot.json`。这些同步请求只读网页，不调用模型推理，也不产生模型 Token 费用。

## 本地公网访问

推荐使用两种方式（二选一）：

### 1) 免费稳定版（Cloudflare Named Tunnel，推荐）

这是更稳一点的方式：你给它一个固定的 Cloudflare 子域名，重启后链接不会变。

前提：

- 你在 Cloudflare 上有一个域名（有免费账户即可配置 Tunnel）。
- 已安装 `cloudflared`。

部署步骤：

```bash
brew install cloudflared
```

1. 在 Cloudflare 创建一个 Tunnel，并拿到 `Tunnel token`。
2. 在 Cloudflare 的 `DNS` 中加一条你想用的子域名（比如 `inv.shifeng.com`）指向这个 Tunnel。
3. 在本机创建一个环境文件（不放进仓库）：

```bash
cat > ~/.config/shifeng-investment/tunnel.env <<'EOF'
export CLOUDFLARE_TUNNEL_TOKEN=你的_TOKEN
export CLOUDFLARE_TUNNEL_MODE=stable
export CLOUDFLARE_TUNNEL_TRANSPORT_PROTOCOL=http2
export CLOUDFLARE_TUNNEL_HOSTNAME=inv.shifeng.com
export CLOUDFLARE_TUNNEL_EDGE_IP_VERSION=auto
export CLOUDFLARE_TUNNEL_NAME=shifeng-investment
EOF
chmod 600 ~/.config/shifeng-investment/tunnel.env
```

4. 在项目目录运行：

```bash
npm run public:tunnel
```

终端里会启动固定域名站点（你在 DNS 设置的域名），同事可直接访问。
说明：`CLOUDFLARE_TUNNEL_MODE=stable` 会在缺 token 时直接报错，不会退化到 Quick Tunnel。

你也可以把服务装进 launchd 后台（重启后也能自动启动）：

```bash
launchctl bootout gui/$(id -u) com.shifeng-investment.cloudflare-tunnel >/dev/null 2>&1 || true
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.shifeng-investment.cloudflare-tunnel.plist"
```

### 2) 快速演示版（Quick Tunnel）

如果你临时想发一个临时口子，可以直接用：

```bash
unset CLOUDFLARE_TUNNEL_TOKEN
unset CLOUDFLARE_TUNNEL_TOKEN_FILE
unset CLOUDFLARE_TUNNEL_ENV_FILE
export CLOUDFLARE_TUNNEL_MODE=quick
export CLOUDFLARE_TUNNEL_TRANSPORT_PROTOCOL=auto
npm run public:tunnel
```

它会走临时 `https://*.trycloudflare.com`，特点是：

- 链接每次会变；
- 需要你本机和终端窗口保持存活。

> Stable 模式更稳，Quick Tunnel 仅作为备用/应急使用。

## 开发说明

This project uses React + TypeScript + Vite.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
