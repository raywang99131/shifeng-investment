# Shifeng Investment 自动部署

完成这套配置后，日常流程只有：在开发电脑修改代码，提交并合并到 GitHub `main`。GitHub 会构建整个项目，常开电脑上的 `shifeng-prod` runner 会自动下载并重启前后端网站。

Cloudflare Tunnel 不保存代码，也不参与构建。它继续独立地把域名转发到常开电脑的 `http://localhost:3000`。

## 常开电脑只做一次

目前已确认 GitHub runner 为 `Idle`、带 `shifeng-prod` 标签，Cloudflare Tunnel 为 `Healthy`。还需要确认 Node.js 版本：

```bash
node --version
```

输出应为 `v24.x.x`。GitHub 工作流也会在部署 job 中准备 Node.js 24。

创建只属于常开电脑的配置目录：

```bash
mkdir -p "$HOME/.config/shifeng-investment"
chmod 700 "$HOME/.config/shifeng-investment"
touch "$HOME/.config/shifeng-investment/server.env"
chmod 600 "$HOME/.config/shifeng-investment/server.env"
```

`server.env` 用于网站后端环境变量。没有额外配置时可以保持为空。不要把它、Tunnel token 或 GitHub runner token 提交到 GitHub。

如果常开电脑现在已有一份正在运行的旧网站，并且要继承它的新闻、基金、交易拥挤度、研究报告等数据，再创建：

```bash
touch "$HOME/.config/shifeng-investment/deploy.env"
chmod 600 "$HOME/.config/shifeng-investment/deploy.env"
```

在 `deploy.env` 中只写旧网站的绝对目录，例如：

```text
SHIFENG_LEGACY_ROOT=/Users/你的用户名/旧网站目录/shifeng-investment
```

这只在第一次迁移数据时使用。如果常开电脑没有旧网站数据，可以不创建 `deploy.env`。

## 第一次发布

部署代码合并到 `main` 后，在 GitHub 仓库的 Actions 页面打开 `Deploy production`。工作流会自动完成：

1. 构建前端并打包前端、后端和 Python 脚本。
2. 把发布包发送到 `shifeng-prod` runner。
3. 安装到 `$HOME/services/shifeng-investment/releases/<提交SHA>`。
4. 保留共享运行数据，切换 `current` 版本。
5. 用 launchd 启动网站，检查健康状态和提交 SHA。
6. 检查失败时自动恢复上一版本。

第一次部署如果提示 `Port 3000 is already in use`，先在常开电脑检查占用程序：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

部署程序不会擅自结束未知进程。确认它是旧的 Shifeng Investment Node 服务后再停止旧服务，然后在 GitHub Actions 页面点 `Re-run failed jobs`。不要停止独立运行的 Cloudflare Tunnel。

## 验证是否真的更新

在常开电脑执行：

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/build-meta
launchctl print "gui/$(id -u)/com.shifeng-investment.server"
```

`/api/health` 应返回 `status: ok`，`/api/build-meta` 的 `git` 应等于刚合并到 `main` 的完整提交 SHA。

随后通过 `www.shifeng-investment.com` 检查页面。确认常开电脑部署正常后，停止开发电脑上同一个 Cloudflare Tunnel 的副本，避免 Cloudflare 在两台电脑之间分配流量，导致用户偶尔看到旧版本。

## 以后怎么用

以后不需要登录常开电脑拉代码，也不需要向 Cloudflare 上传代码：

```text
开发电脑修改代码 → push/合并 GitHub main → 常开电脑自动部署 → Tunnel 转发新网站
```

GitHub 工作流失败时，旧网站会继续运行或自动回滚。先查看 `Deploy production` 的失败步骤；常开电脑的服务日志位于：

```text
$HOME/services/shifeng-investment/shared/logs/
```

生产发布目录不应放在 Desktop 或 Documents 下，默认 `$HOME/services/shifeng-investment` 可避开 macOS 后台服务的目录隐私权限问题。
