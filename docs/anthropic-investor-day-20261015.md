# Anthropic投资者日补充留档 · 2026-10-15

事件为2026-10-14美国旧金山Pre-IPO Investor Day；核对及收到中金纪要日期为2026-10-15。金额统一为亿美元（USD 100 million）；季度环比在数据接口中存比值，TSV展示为百分数。

Reuters季度营收Q1/Q2/Q3为47/116/168；前三季331为加总计算，Q3年化672为168×4，不等于ARR。旧收入对比页Q1=48、Q2=109保留，不能与Reuters47/116混用。中金摘录“16.8亿美元”与Reuters16.8bn=168亿美元相差10倍，保留原摘要并标单位疑误，不据此调整季度收入。

财通、建投及中金共同给出9月ARR约700的历史研究推算，日期精度为月份；季度总收入不足以独立反推9月单月收入。财通转引740并非直接查阅Yipit报告所得；中金另转引高频Yipit750及TickerTrends768，观测截至日均未提供，10/15只是收到日，不能套用9/30。740/750/768均不写入历史ARR或资本事件。

拟议IPO估值18000–20000为独立情景假设；11/9所在周指正式营销启动预期，11/26前交易为消息人士目标，均非确定日期。

| ARR口径 | ARR（亿美元） | 对应P/ARR（倍） |
| --- | ---: | ---: |
| 三份纪要共同采用的9月ARR | 700 | 25.7–28.6 |
| 财通转引的740亿美元估算 | 740 | 24.3–27.0 |
| 财通年底ARR研究预测 | 800–850 | 21.2–25.0 |
| 建投年底ARR研究情景 | 1000 | 18.0–20.0 |

财通年底800–850为研究预测、非公司指导；建投1000为单独研究情景，不暗示市场共识。区间倍数下界以估值下限÷ARR上限，上界以估值上限÷ARR下限。

来源：[Reuters 10/14署名转载](https://uk.marketscreener.com/news/anthropic-s-q3-revenue-surges-45-to-nearly-17-billion-ce785dd2d08cf221)；[FT 10/14](https://www.ft.com/content/11632d03-358c-454b-af95-d06d4072932b)；[Bloomberg/TBS授权转载](https://newsdig.tbs.co.jp/articles/withbloomberg/3010144?display=1)；[用户纪要所在飞书ARR页](https://xcn0zaydz11m.feishu.cn/sheets/F9W3s5BBEhRRV8tdZvCchEAfnCf?sheet=0rbUAO)。Bloomberg原稿10/1、转载10/14。FT付费正文未完整读取；连续两季调整后盈利、营业利润率11%、算力收入比1.7为用户纪要转引，现金流仅表述为“当季现金流为正、具体口径未披露”。5180十年云/算力/基础设施承诺为Reuters9/29已披露、10/14重述，非当日新增资本开支。

飞书范围：ARR与估值页A60:H89；中金独立补充A92:H98；收入对比页补充A52:H65；IPO页补充A10:H22。原IPO摘要9000–10000作为旧口径保留，由10/15拟议18000–20000补充。IPO页C3主摘要由主任务更新为当日新媒体预期，C2历史融资保留；拟议IPO不混入历史融资估值。

留档产物：reviewed-investor-day.json与当前数据及四情景一致；feishu-income-supplement-A52-H65.tsv为14×8；feishu-ipo-supplement-A10-H22.tsv为13×8。ARR补充TSV同步B70/B82为“三份纪要”、D68:E68为146.8、D69:E69为44.8，其余内容保留；中金补充TSV保留。

验证：86项前端测试、scoped lint及生产构建通过（主任务验证）。本次留档另核对JSON一致性、TSV行列、关键金额及空观测日期。

首次经营数据更新部署：代码提交ecb8810已推送；Cloudflare正式版本43b459b2-f2d7-408e-8961-4926bc57c0d6，使用wrangler.jsonc并保留运行变量。正式域名https://www.shifeng-investment.com/ai-dashboard已核验168/331/700及750/768、四情景、现金流措辞；控制台无错误。飞书重新加载后，三个栏目均保留新增值与格式。

验收截图存于output/anthropic-investor-day-20261015：website-revenue-live.png、website-cicc-live.png、feishu-arr-saved.png、feishu-cicc-saved.png、feishu-income-saved.png、feishu-ipo-saved.png。手机390px布局无页面横向溢出，宽表在自身容器滚动。


## 同日追加：增速与竞争研究纪要

新增10条归因明确的研究补充，作者未署名、收到日期10/15。季度收入仍47/116/168；按相同数据复算Q2/Q3环比为146.8%/44.8%。原纪要143%/46%以转述保留，FT旧版Q2=115对应Q3约46.1%，未混用季度版本。

月增约5%、调整后毛利率85%、具体行情跌幅保留为纪要转述待核；85%不替代营业利润率11%，AnthropicUSDT不称公司股票。匿名投资者反馈与杰文斯效应属于研究观点。新增内容不进入历史ARR、资本事件、估值数组或Token流量图。

Ramp官方10/14月报的9月供应商付费采用率为Anthropic43.8%、OpenAI40.6%，不同于模型消费额占比。Astra13%/Claude8%的原始模型样本、日期及分母未取得。模型样本方法另见[Ramp八月说明](https://ramp.com/data/ai-index-august-2026)，原始[Ara Kharazian X帖](https://x.com/arakharazian/status/2099898023346053627)本次无法读取；不以镜像页面代替已核原始证据。[Ramp十月月报](https://ramp.com/data/ai-index-oct-2026)。

[OpenRouter 9/22文章](https://openrouter.ai/data/newsletter/the-token-state-of-play)支持9/7当周OpenAI占两家合计消费金额略超50%，官方称自2024-02-24当周以来首次，排除转售活动；限该平台及该周度窗口，首次未独立复算，不写成10月全市场收入份额。[10/1文章](https://openrouter.ai/data/newsletter/model-half-life)只支持Opus5.5发布首周强劲，不证明完整10月份额已改善。

[BLS 10/14发布](https://www.bls.gov/news.release/archives/cpi_10142026.htm)核对9月CPI同比3.7%、季调环比0.6%，美东08:30发布；一致预期和行情归因另待核。[Endpoints主办方记者议程公告](https://www.linkedin.com/posts/max-bayer-20435179_endpoints-news-ai-day-2026-ai-in-biopharma-activity-7504216340757372928-TqW0)列Nathan Frey，10/14 AI Day 2026活动日期已过，跟踪发言实录，不能写成未来确定催化。[活动网址](https://events.endpoints.news/aiday2026/)本次正文未取得。

飞书ARR页新增A102:H114；C104:F114合并形成核对说明列，原历史数据及前述投资者日更新保留。重载后验证首尾记录均已保存。留档在output/anthropic-investor-day-followup-20261015，包括13×8 TSV、reviewed-followup.json、网站及飞书首尾截图。

本轮验证：原有86项测试全部通过，scoped ESLint与生产构建通过；390px手机页面无整体横向溢出，研究宽表仅在表格容器内滚动。正式域名已验证10条内容及来源，控制台无错误。当前Cloudflare版本0bee4d56-c536-4c7e-82a5-a41208848b96。
