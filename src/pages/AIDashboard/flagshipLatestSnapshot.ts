import { FLAGSHIP_PRICE_ROWS, flagshipModelLabel, type FlagshipPriceRow, type FlagshipPriceValue } from './flagshipPriceSnapshot.ts';
import { FLAGSHIP_AA_VERIFIED } from './flagshipAaVerified.ts';

export const LATEST_MODEL_REVIEW = {
  date: '2026-10-13', indexVersion: FLAGSHIP_AA_VERIFIED.indexVersion,
  methodologyUrl: FLAGSHIP_AA_VERIFIED.methodologyUrl,
  summary: '核对原图 27 个已收录分数，并补充近期发布、轻量与订阅模型。各模型评测配置见明细；公开权重不代表免费托管 API。',
} as const;

const fixed = (raw: string): FlagshipPriceValue => ({ raw, lower: Number(raw), upper: Number(raw), kind: 'fixed' });
const tiered = (raw: string, lower: number, upper: number): FlagshipPriceValue => ({ raw, lower, upper, kind: 'tiered' });
const missing = (): FlagshipPriceValue => ({ raw: '', lower: null, upper: null, kind: 'missing' });

type PriceUpdate = Pick<FlagshipPriceRow, 'input' | 'output' | 'note'> & Partial<FlagshipPriceRow>;
const vendorUpdates: Record<string, PriceUpdate> = {
  'claude-opus-5-5': { input: fixed('4'), output: fixed('20'), cacheReadPrice: 0.2, note: '标准模式', priceSourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing', releasedAt: '2026-09-22', detailNote: '1M 上下文无长上下文溢价；Fast 服务模式为 8/40，缓存未核实。' },
  'claude-sonnet-5-5': { input: fixed('2'), output: fixed('10'), cacheReadPrice: 0.1, note: '', priceSourceUrl: 'https://www.anthropic.com/claude-haiku-5-5', releasedAt: '2026-09-28', detailNote: '10/7 缓存读取由 0.20 降至 0.10；1M 上下文无溢价。' },
  'claude-haiku-5-5': { input: tiered('0.10 / 0.50', .1, .5), output: tiered('0.50 / 2.50', .5, 2.5), note: '≤100K / >100K', priceSourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing', releasedAt: '2026-10-07', detailNote: '100K 阈值计入输入、缓存读写，超过后整次请求按高档计价；缓存读取为 0.01/0.05。' },
  'gpt-6-astra': { input: tiered('10 / 20', 10, 20), output: tiered('50 / 75', 50, 75), note: '≤272K / >272K', priceSourceUrl: 'https://developers.openai.com/api/docs/pricing', detailNote: '仅标准服务档，缓存读取 1/2；Ultrafast 为标准 6 倍，另列而不混作标准 API 刊例。' },
  'gpt-6-1-sol': { input: tiered('2 / 4', 2, 4), output: tiered('10 / 15', 10, 15), note: '≤272K / >272K', priceSourceUrl: 'https://developers.openai.com/api/docs/pricing', releasedAt: '2026-09-29', detailNote: '标准服务档；缓存读取 0.1/0.2，Ultrafast 输入 12/24、缓存 0.6/1.2、输出 60/90；10/8新增该服务档，非新型号。' },
  'gpt-6-sol': { input: fixed('2'), output: fixed('10'), cacheReadPrice: .2, note: '标准 · ≤272K', priceSourceUrl: 'https://developers.openai.com/api/docs/pricing', releasedAt: '2026-09-22', detailNote: '图中仅标准服务、输入≤272K档；长上下文及其他服务档按官网另计。' },
  'gpt-6-luna': { input: tiered('0.10 / 0.20', .1, .2), output: tiered('0.50 / 0.75', .5, .75), note: '≤272K / >272K', priceSourceUrl: 'https://developers.openai.com/api/docs/pricing', releasedAt: '2026-09-22', detailNote: '标准服务档；缓存读取0.01/0.02；地区附加费另计。' },
  'gemini-4-argon': { input: missing(), output: missing(), note: '灰度预发布 · 公开 API 未确认', priceSourceUrl: 'https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/', releasedAt: '2026-09-30', detailNote: '公告首发预告价2/10、优惠后4/20；尚未确认通用API型号ID或全面开放日，不把预告价画为当前可调用 API。' },
  'muse-wonder': { input: fixed('4'), output: fixed('20'), cacheReadPrice: .2, note: 'Preview', priceSourceUrl: 'https://dev.meta.ai/docs/pricing-rate-limits', releasedAt: '2026-10-12', detailNote: 'muse-wonder-1.0；上下文1,048,576；无长上下文溢价；网页搜索另外计费。' },
  'muse-wonder-full': { input: missing(), output: missing(), note: '仅订阅 · $50 / $200 月费', priceSourceUrl: 'https://dev.meta.ai/models/muse-wonder', releasedAt: '2026-10-12', detailNote: 'Muse Code Power Usage $50/月、Everyday Usage 20x；Maximum $200/月、80x；未提供 Model API。' },
  'grok-4-7': { input: tiered('2 / 4', 2, 4), output: tiered('6 / 12', 6, 12), note: '标准 · 短/长上下文', priceSourceUrl: 'https://docs.x.ai/developers/models/grok-4.7', releasedAt: '2026-09-21', detailNote: '长上下文阈值约200K；表格与说明对等号边界表述不一致。缓存0.5/1；Fast仅Cursor/Grok Build，不是独立公开API；美国区域1.1倍。' },
  'gemini-3-8-flash': { input: fixed('0.75'), output: fixed('3.75'), cacheReadPrice: .075, note: '优惠至2026-12-31', outputSuffix: '', priceSourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', releasedAt: '2026-09-02', detailNote: '2027/1/1起输入1.5、缓存0.15、输出7.5；存储及其他服务档另计。' },
  'gemini-3-7-flash': { input: missing(), output: missing(), note: '已弃用 · 请求转至3.8', outputSuffix: '', priceSourceUrl: 'https://ai.google.dev/gemini-api/docs/changelog', detailNote: '10/8起API请求自动路由gemini-3.8-flash；此行指数是原3.7模型评测，不能当作当前路由模型分数。' },
  'mistral-large-4': { input: tiered('0.68 / 1.36', .68, 1.36), output: tiered('2.09 / 4.18', 2.09, 4.18), cacheReadPrice: .07, note: '首发优惠 / 常规价', priceSourceUrl: 'https://docs.mistral.ai/models/mistral-large-4-0', releasedAt: '2026-10-06', detailNote: 'Public Preview；10/6首发两周50%优惠，未披露精确结束时刻。缓存优惠0.07、常规0.14；权重coming soon不代表已开放。' },
  'glm-5-3-flash': { input: fixed('0.15'), output: fixed('0.50'), cacheReadPrice: .03, note: '1M 上下文', priceSourceUrl: 'https://docs.z.ai/guides/overview/pricing', releasedAt: '2026-08-26', detailNote: '发布日采用官方更新日志；128K最大输出；global USD价，国内CNY价格独立。' },
  'glm-5-3-flashx': { input: fixed('0.37'), output: fixed('1.25'), cacheReadPrice: .075, note: '1M 上下文 · 约200 TPS', priceSourceUrl: 'https://docs.z.ai/guides/overview/pricing', releasedAt: null, detailNote: 'Flash加速版；最大输出128K；Coding Plan暂未开放；独立发布日期与AA综合分数未查到，不复制Flash分数。' },
  'mimo-v2-6-pro': { input: fixed('0.435'), output: fixed('0.87'), cacheReadPrice: .0036, note: '标准服务档', priceSourceUrl: 'https://mimo.mi.com/docs/pricing', releasedAt: '2026-09-22', detailNote: '官方Model Release日期9/22（AA记录9/21）；1M上下文、128K输出；批处理半价；UltraSpeed为4.35/0.036/8.7。国内CNY3/0.025/6，不做美元反推。' },
  'mimo-v2-6-flash': { input: fixed('0.14'), output: fixed('0.28'), cacheReadPrice: .0028, note: '1M 上下文', priceSourceUrl: 'https://mimo.mi.com/docs/pricing', releasedAt: '2026-09-22', detailNote: '官方Model Release日期9/22（AA记录9/21）；128K输出；批处理半价；国内CNY1/0.02/2。' },
  'step-5': { input: fixed('1'), output: fixed('2.70'), cacheReadPrice: .1, note: 'Preview · API已开放', priceSourceUrl: 'https://platform.stepfun.ai/docs/en/guides/pricing/details', releasedAt: '2026-09-20', detailNote: '英文官网USD刊例1/0.1/2.7；官网新闻9/20，AA记录9/18。权重计划10/15开放。中文缓存另有10/14生效调价及既有用户保价，不用USD反推CNY。' },
  'mercury-2-5': { input: tiered('0.04 / 0.20', .04, .2), output: tiered('0.15 / 0.75', .15, .75), cacheReadPrice: .004, note: '80%优惠 / 刊例', priceSourceUrl: 'https://docs.inceptionlabs.ai/get-started/models', releasedAt: '2026-09-08', detailNote: '当前首发优惠80%，结束日未披露；缓存优惠0.004、刊例0.02。AA旧刊例输入0.25，按厂商现刊例0.20纠正；新户免费额度官网不同页面冲突，不作为永久免费价。' },
  'solar-mini4': { input: tiered('0.05 / 0.10', .05, .1), output: tiered('0.20 / 0.40', .2, .4), cacheReadPrice: .005, note: '优惠至10/22 UTC', priceSourceUrl: 'https://www.upstage.ai/pricing/api', releasedAt: '2026-09-22', detailNote: '50%优惠2026-10-11 00:00至10-23 00:00 UTC（不含结束时刻）；缓存优惠0.005、刊例0.01；官网税前价。' },
  'k2-horizon-375b-a23b': { input: missing(), output: missing(), note: '公开 API 刊例价未核实', priceSourceUrl: 'https://ifm.ai/k2/press-release/', releasedAt: '2026-09-03', detailNote: 'Apache2.0权重；官方API入口及伙伴渠道已确认，公开价格/免费额度未核实；AA的0/0不代表厂商免费托管API。' },
  'minicpm5-2b': { input: missing(), output: missing(), note: '自托管 · API价未核实', priceSourceUrl: 'https://github.com/OpenBMB/MiniCPM', releasedAt: '2026-09-07', detailNote: 'Apache2.0开放权重；官方本地/自托管方案及在线演示，无已核实第一方托管API刊例。' },
  'glm-5-3': { input: fixed('1.4'), output: fixed('4.4'), cacheReadPrice: .26, note: 'Global USD 刊例', priceSourceUrl: 'https://docs.z.ai/guides/overview/pricing', releasedAt: '2026-08-18', detailNote: '国内CNY输入8、缓存2、输出28；与Global美元刊例分别计价。' },
  'qwen-3-8-max-0902': { input: fixed('2'), output: fixed('6'), note: '国际标准服务档', priceSourceUrl: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing', releasedAt: '2026-09-02', detailNote: 'qwen3.8-max-2026-09-02；国内标准CNY12/36，Prime24/72。10/8美国地域开放并非新一代模型；缓存报价未列示。' },
  'kimi-k3': { input: fixed('3'), output: fixed('15'), cacheReadPrice: .3, note: '1M 上下文', priceSourceUrl: 'https://platform.kimi.ai/docs/pricing/chat-k3.md', releasedAt: '2026-07-17', detailNote: 'USD缓存写入5分钟3、1小时6；CNY输入20、缓存命中2、输出100，缓存写入5分钟20、1小时40（每百万tokens）。输入/输出与缓存写入分列，币种分别计价。' },
  'minimax-m3': { input: tiered('0.30 / 0.60', .3, .6), output: tiered('1.20 / 2.40', 1.2, 2.4), note: '≤512K / >512K', priceSourceUrl: 'https://platform.minimax.io/docs/guides/pricing-paygo', detailNote: '标准服务档，缓存命中0.06/0.12；Priority输入0.45/0.90、缓存0.09/0.18、输出1.8/3.6。' },
  'minimax-m3-1-flash': { input: missing(), output: missing(), note: 'Preview · 仅 M Plan 订阅', priceSourceUrl: 'https://agent.minimax.io/tools/m3-1-flash-preview', detailNote: '1M上下文，当前未提供独立PAYG价；10/1–10/7无限用量活动已结束，首月半价活动至10/14。官方未确认独立发布日期或AA指数。' },
  'longcat-2-5-preview': { input: fixed('0.30'), output: fixed('1.20'), cacheReadPrice: .006, note: '限时价 · 结束日未披露', outputSuffix: '', priceSourceUrl: 'https://longcat.ai/platform/docs/pricing/longcat-2.5', releasedAt: '2026-09-25', detailNote: '1M上下文、128K输出；国内CNY2/0.04/8；支持按量计费，可选30天预付Token包，不是强制订阅。AA未收录。' },
  'ling-3-1-flash': { input: fixed('0'), output: fixed('0'), cacheReadPrice: 0, note: '两周限时免费 · 正式价待公布', priceSourceUrl: 'https://developer.ant-ling.com/en/docs/models/price', releasedAt: '2026-09-30', detailNote: '第一方API官方列示CNY输入/缓存/输出均0，免费金额在各币种均为0；两周活动精确结束日期未披露。API当前256K上下文，模型训练上下文1M；不按永久免费解读。' },
  'deepseek-v4-1-flash': { input: tiered('0.15 / 0.30', .15, .3), output: tiered('0.60 / 1.20', .6, 1.2), note: '低谷 / 高峰时段', priceSourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/', releasedAt: '2026-09-10', detailNote: '缓存0.003/0.006；工作日（不含中国法定节假日）北京时间09–12、14–18高峰价；其他时段低谷价。1M上下文、384K输出。' },
  'deepseek-v4-pro': { input: tiered('0.66 / 1.32', .66, 1.32), output: tiered('1.98 / 3.96', 1.98, 3.96), note: '继续提供 · 低谷 / 高峰', priceSourceUrl: 'https://api-docs.deepseek.com/updates/', releasedAt: '2026-08-13', detailNote: '最新官方变更记录已撤回9/10公告中的停服安排，9/14后继续提供V4 Pro，计费不变。缓存0.022/0.044；高峰时段与V4.1 Flash相同。原新闻的临时路由说明已过时，以最新Change Log为准。' },
  'ling-3-0-flash-vl': { input: missing(), output: missing(), note: '第一方美元 API 价未列示', priceSourceUrl: 'https://developer.ant-ling.com/en/docs/models/price', releasedAt: '2026-09-04', detailNote: '第一方CNY促销输入0.14/缓存0.028/输出0.42，常规0.5/0.1/1.5；官网美元报价对应第三方OpenRouter/ZenMux，不混作第一方报价。9/9开放权重；AA日期是评测记录日。' },
  'ling-3-0-flash-fin': { input: missing(), output: missing(), note: '第一方 API 刊例价未列示', priceSourceUrl: 'https://huggingface.co/inclusionAI/Ling-3.0-flash-Fin', releasedAt: '2026-08-27', detailNote: '开放权重；OpenRouter/Novita第三方促销USD输入0.042、缓存0.0084、输出0.1232，常规0.075/0.015/0.22；第一方价格未列示。AA日期不是厂商首发日。' },
  'kimi-k2-8-preview': { input: missing(), output: missing(), note: 'Kimi Code订阅 · ¥99/月起', priceSourceUrl: 'https://www.kimi.com/help/kimi-code/models', releasedAt: '2026-09-11', detailNote: 'kimi-for-coding原位升级；最高1M上下文，low/high/max；9/11上线记录见Kimi Code最新动态；未核到独立PAYG报价或AA综合分。新Plus/Pro/Max月付99/199/699元；年付折合79/159/559元每月，Go新套餐不含Code，旧Andante另保留Code权益。' },
};

function withEvaluation(row: FlagshipPriceRow, evaluation: typeof FLAGSHIP_AA_VERIFIED.models[number] | undefined): FlagshipPriceRow {
  return { ...row, ...(evaluation ? {
    score: evaluation.scoreRounded, scoreRaw: String(evaluation.scoreRounded), scoreSourceUrl: evaluation.modelSourceUrl,
    evaluationLabel: evaluation.configurationSuffix || evaluation.effort || 'AA 标准配置',
  } : {}), ...(vendorUpdates[row.id] || {}) };
}

const original = FLAGSHIP_PRICE_ROWS.map(row => withEvaluation(row, FLAGSHIP_AA_VERIFIED.models.find(model => model.originalSourceOrder === row.sourceOrder)));
const additional = FLAGSHIP_AA_VERIFIED.models.filter(model => model.originalSourceOrder === null).map((model, index) => withEvaluation({
  id: model.slug, sourceOrder: 30 + index, model: model.shortName.replace(/ \((?:max|high).*\)$/i, ''), sourceStar: false,
  score: model.scoreRounded, scoreRaw: String(model.scoreRounded), input: missing(), output: missing(),
  note: '厂商 API 刊例价未核实', detailNote: `AA记录发布日期${model.releaseDateReportedByAA}；厂商首发日期与托管报价未独立核实。`,
}, model));
const unscored = ['glm-5-3-flashx', 'kimi-k2-8-preview'].map((id, index) => withEvaluation({
  id, sourceOrder: 100 + index, model: id === 'glm-5-3-flashx' ? 'GLM-5.3-FlashX' : 'Kimi K2.8 Preview', sourceStar: false,
  score: null, scoreRaw: '未收录', input: missing(), output: missing(), note: '',
}, undefined));

export const LATEST_FLAGSHIP_ROWS: readonly FlagshipPriceRow[] = [...original, ...additional, ...unscored]
  .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.sourceOrder - b.sourceOrder);

export function latestFlagshipExportRows(): string[][] {
  return LATEST_FLAGSHIP_ROWS.map((row, index) => [LATEST_MODEL_REVIEW.date, String(index + 1), flagshipModelLabel(row), row.scoreRaw,
    row.input.raw || '未列示', row.output.raw || '未列示', `${row.note}${row.detailNote ? `；${row.detailNote}` : ''}`,
    row.priceSourceUrl || (row.sourceOrder <= 29 && (row.input.lower !== null || row.output.lower !== null) ? '用户提供原图' : '未核实厂商 API 单价'), LATEST_MODEL_REVIEW.indexVersion, row.evaluationLabel || '未收录', row.scoreSourceUrl || '未收录',
    row.releasedAt || '未独立核实', row.cacheReadPrice === null || row.cacheReadPrice === undefined ? '未列示/见分档说明' : String(row.cacheReadPrice)]);
}
export const LATEST_FLAGSHIP_COLUMNS = ['核对日期', '显示顺序', '模型', 'AA 智能指数', '输入价（USD/百万tokens）', '输出价（USD/百万tokens）', '说明与条件', '价格来源', 'AA 指数版本', 'AA 评测配置', 'AA 来源', '官方发布日期', '缓存命中价（USD/百万tokens）'];
export function buildLatestFlagshipTsv(): string {
  return [LATEST_FLAGSHIP_COLUMNS, ...latestFlagshipExportRows()].map(row => row.map(value => value.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}
export function buildLatestFlagshipCsv(): string {
  return [LATEST_FLAGSHIP_COLUMNS, ...latestFlagshipExportRows()].map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
