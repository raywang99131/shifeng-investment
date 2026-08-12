# 交易拥挤度东财缓存口径

## 口径原则

- 交易拥挤度的成交额、Top100、换手率、量比只使用东方财富数据。
- 不使用 Tushare 或其他第三方源补成交额集中度、Top100、换手率、量比。
- 不使用 `push2test.eastmoney.com` 写入生产缓存；该测试域返回值曾与东财实时快照不一致。

## 当前可稳定使用的数据链路

- 页面首次打开先读取本地缓存 `server/data/tmt-margin/latest.json`。
- 如果当天东财快照尚未刷新，前端会后台调用 `/api/tmt-margin/spot-refresh`。
- 轻量快照脚本会抓取东财全A实时横截面，覆盖不足时拒绝写入。
- 成功快照会写入 `server/data/tmt-margin/eastmoney-spot-snapshots.json`，并合并回 `latest.json`。

## 每日快照脚本

```bash
scripts/refresh_eastmoney_spot_snapshot.sh
```

这个脚本只刷新东财实时快照，不跑慢速历史 K 线。后续如果需要自动化，可以把它接到本机 `launchd` 或 `cron`。

## 历史 K 线渐进脚本

```bash
scripts/crawl_eastmoney_kline_batch.sh
```

这个脚本用于慢慢爬取东财历史 K 线，默认从 2012-01-01 开始，每批最多 20 只股票。只有单日覆盖股票数达到门槛，才会聚合成长历史并合并到页面，避免少量股票误当全市场。

可用环境变量调整批次：

```bash
MAX_CODES=50 DELAY=2 scripts/crawl_eastmoney_kline_batch.sh
```

查看本地进度：

```bash
python3 scripts/backfill_trading_congestion_eastmoney.py status --recent-days 100
```

只看关键字段：

```bash
python3 scripts/backfill_trading_congestion_eastmoney.py status --recent-days 100 --json-field kline_cached_stocks,kline_long_history_remaining_stocks,kline_source_cooldown_remaining_seconds
```

状态里重点看：

- `top100_recent_days`：已有东财 Top100 明细的交易日数量。
- `turnover_filled` / `volume_ratio_filled`：已有日期内换手率、量比补齐行数。
- `kline_coverage_progress`：东财历史 K 线覆盖全A股票池的比例。
- `kline_long_history_remaining_stocks`：距离长历史聚合门槛还差的股票数量。
- `kline_source_cooldown_remaining_seconds`：东财历史 K 线坏窗口剩余冷却秒数。
- `kline_source_cooldown_until`：按本机时间估算的下一次可重试时间。

## 本机定时任务脚本

```bash
scripts/install_eastmoney_spot_snapshot_launchd.sh
scripts/uninstall_eastmoney_spot_snapshot_launchd.sh
scripts/install_eastmoney_kline_crawl_launchd.sh
scripts/uninstall_eastmoney_kline_crawl_launchd.sh
```

安装脚本会把东财快照刷新接到 macOS `launchd`，默认周一到周五 15:45 本机时间运行一次。卸载脚本会移除对应任务。当前仓库只提供脚本，不默认安装后台任务。

历史 K 线渐进任务默认周一到周五 16:20 本机时间运行一次，每批小量爬取并尊重 15 分钟全局冷却。它和每日快照任务分开，避免历史接口坏窗口影响当天实时快照沉淀。

## 历史回溯状态

- 东财历史 K 线主接口当前在本机环境会主动断开连接。
- 最近100个交易日的历史换手率/量比，仍依赖真实东财历史 K 线恢复后渐进回补。
- 2012年至今长历史也只允许由真实东财历史 K 线缓存聚合生成。
- 如果东财历史 K 线连续失败，脚本会进入 15 分钟全局冷却；前端“小批量回溯”按钮会显示“冷却中”，避免反复请求坏窗口。
- 历史 K 线冷却不影响“刷新东财快照”；当天实时横截面仍可继续沉淀。

## 前端展示约定

- 样本不足时，指标卡显示“分位待补”，不展示误导性历史分位。
- 交易页“刷新东财快照”只跑轻量东财实时快照。
- “尝试小批量回溯”才会触发慢速东财历史 K 线回补。
- “长历史小批量”会触发少量股票的东财历史 K 线渐进爬取，用于最终生成 2012 至今长历史；冷却期会自动跳过。
