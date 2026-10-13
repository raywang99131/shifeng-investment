// Official specialist-model and access updates checked on 2026-10-13.
export const RECENT_SPECIALIST_UPDATES: readonly {
  vendor: string;
  model: string;
  date: string | null;
  status: string;
  pricing: string | null;
  aaIntelligenceIndex?: number | null;
  supportingSources?: readonly { label: string; url: string }[];
  sourceUrl: string;
  note: string;
}[] = [
  {
    vendor: '智谱', model: 'GLM-Legal', date: '2026-10-12',
    status: 'Beta；API需申请接入', pricing: null, aaIntelligenceIndex: null,
    sourceUrl: 'https://z.ai/blog/glm-legal',
    supportingSources: [
      { label: 'Vals 法律评测', url: 'https://www.vals.ai/models/zai_glm-legal' },
      { label: '官方 API 接入申请', url: 'https://z.ai/consultation/legal' },
    ],
    note: '以 GLM-5.3-Flash 为底座，面向合同审查、证据分析与合规工作流。Vals Harvey LAB 得分 19.17%，评测页当前第 7/79；这是法律领域评测，不是 AA 综合智能指数。官方 API 刊例价与 AA 综合指数未核实，均留空；AutoClaw 即将接入。',
  },
  {
    vendor: 'Google', model: 'Nano Banana 2.1', date: '2026-10-06',
    status: '正式开放；图像生成',
    pricing: '输入 $1.50/百万 Token；文本输出 $7.50/百万 Token；图像输出 $30/百万图像 Token',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    note: 'gemini-nano-banana-2.1；1K/2K/4K 图像约 $0.0336/$0.0504/$0.113 每张；Batch 半价。图像输出单独计费。',
  },
  {
    vendor: 'Google', model: 'Gemini 3.8 Flash TTS', date: '2026-09-22',
    status: '正式开放；文本转语音',
    pricing: '至 2026-12-31：文本输入 $0.50/百万 Token，音频输出 $9/百万音频 Token',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    note: 'gemini-3.8-flash-tts；2027-01-01 起输入/音频输出 $1/$18；音频为 25 Token/秒，缓存价未列示。',
  },
  {
    vendor: 'Google', model: 'Gemini 3.8 Flash-Lite TTS', date: '2026-09-22',
    status: '正式开放；文本转语音',
    pricing: '至 2026-12-31：文本输入 $0.50/百万 Token，音频输出 $6/百万音频 Token',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    note: 'gemini-3.8-flash-lite-tts；2027-01-01 起输入/音频输出 $1/$12；音频为 25 Token/秒，缓存价未列示。',
  },
  {
    vendor: 'Google', model: 'Gemini 3.8 Live / Extended Thinking', date: '2026-09-15',
    status: '正式开放；实时音频',
    pricing: '每百万 Token：输入文本 $0.75、音频 $3、图像/视频 $1；输出文本 $4.50、音频 $12',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    note: 'gemini-3.8-live 与 gemini-3.8-live-extended-thinking 同价；按实际模态计费，缓存价未列示。',
  },
  {
    vendor: 'xAI', model: 'Grok Voice Transcribe 2.0', date: '2026-09-17',
    status: '语音转写 API',
    pricing: '批量转写 $0.10/音频小时；流式转写 $0.20/音频小时',
    sourceUrl: 'https://docs.x.ai/developers/pricing',
    note: 'grok-voice-transcribe-2.0；10 月 2 日起 1.0 请求重定向至 2.0，价格相同；按音频时长收费。',
  },
  {
    vendor: '阿里云', model: 'Qwen3.8 Omni Flash', date: '2026-09-17',
    status: '百炼 API 已上架；多模态输入、文本输出',
    pricing: '北京/中国内地输入/缓存读/输出 ¥0.80/¥0.10/¥2.70，人民币/百万 Token',
    sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing',
    note: 'qwen3.8-omni-flash；9 月 17 日 API 上架、9 月 18 日博客发布；新加坡输入/缓存读/输出 ¥1.094/¥0.117/¥3.427，按地域计费。',
  },
  {
    vendor: '阿里云', model: 'Qwen3.8 Omni Flash Realtime', date: '2026-09-21',
    status: '百炼 API 已上架；实时音视频交互',
    pricing: '北京每百万 Token（人民币）：文本/图像/视频输入 ¥1.50、音频输入 ¥6；文本输出 ¥4.50、音频输出 ¥12',
    sourceUrl: 'https://help.aliyun.com/zh/model-studio/qwen3-8-omni-flash-realtime',
    note: 'qwen3.8-omni-flash-realtime；日期为 API 上架日，首次研究发布日期未核实；语音与对应文本分别收费，新加坡为 ¥1.677/¥6.781/¥5.104/¥13.636（同序）。',
  },
  {
    vendor: 'Qwen', model: 'Qwen3.8 LiveTranslate', date: '2026-09-18',
    status: '已发布并提供按量 API；实时同声传译',
    pricing: '北京每百万 Token（人民币）：音频输入 ¥40、图片输入 ¥3.30；文本输出 ¥100、音频输出 ¥160',
    sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing',
    note: 'qwen3.8-livetranslate-flash-realtime；日期为研究发布日；新加坡同序美元报价 $7.50/$0.55/$20/$30 每百万 Token，缓存价未列示。',
  },
  {
    vendor: '阿里云', model: 'Qwen Image 2.1 Pro', date: '2026-10-02',
    status: '百炼 API 已上架；图像生成与编辑',
    pricing: '北京输出 ¥0.25/张；新加坡输出 ¥0.283404/张，均为人民币',
    sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing',
    note: 'qwen-image-2.1-pro；日期为 Pro API 上架日，Qwen Image 2.1 系列于 9 月 20 日发布；按张计费，不折算为文本 Token 价格。',
  },
  {
    vendor: '阿里云', model: 'Qwen Image 2.1 Turbo', date: '2026-10-09',
    status: '百炼 API 已上架；图像生成与编辑',
    pricing: '北京输出 ¥0.10/张；新加坡输出 ¥0.113362/张，均为人民币',
    sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing',
    note: 'qwen-image-2.1-turbo；日期为 Turbo API 上架日，系列发布日期与 API 上架日分开列示；按张计费。',
  },
  {
    vendor: '阶跃星辰', model: 'StepAudio 3 系列', date: '2026-09-15',
    status: '已发布；语音识别、合成及实时对话',
    pricing: 'ASR Max：$0.40/音频小时、人民币 ¥2.80/音频小时；TTS：$0.36/万字符、人民币 ¥2.50/万字符',
    sourceUrl: 'https://platform.stepfun.ai/docs/en/guides/pricing/details',
    note: 'Realtime/Chat/Gen/Music Preview 当前限时免费，结束日未列示；ASR Max 与 TTS 按上列专用单位收费；美元与人民币为各地区独立报价。',
  },
  {
    vendor: '小米', model: 'MiMo V2.6 Pro · UltraSpeed', date: '2026-09-22',
    status: '已发布；Pro 加速服务档，需定制访问',
    pricing: '海外输入/缓存读/输出 $4.35/$0.036/$8.70；国内人民币 ¥30/¥0.25/¥60，均为每百万 Token',
    sourceUrl: 'https://mimo.mi.com/docs/pricing',
    note: 'mimo-v2.6-pro-ultraspeed；不支持 Batch；TokenPlan 不含此档，Desktop Premium/Elite 可用。旧 V2.5 系列计划 10 月 21 日退役，截至 10 月 13 日尚未生效。',
  },
  {
    vendor: 'Inception', model: 'Mercury Voice', date: '2026-09-29',
    status: '企业客户开放；需联系启用',
    pricing: '当前首发输入/缓存读/输出 $0.20/$0.02/$0.75；刊例 $0.40/$0.04/$1.50，均为美元/百万文本 Token',
    sourceUrl: 'https://docs.inceptionlabs.ai/get-started/models',
    note: '面向语音智能体对话的文本模型；不生成音频。首发五折结束日未列示，未核实公开模型 ID 或 AA 综合分。',
  },
  {
    vendor: 'Inception', model: 'Mercury Decide', date: null,
    status: '分类与决策专用 API；发布日期未核实',
    pricing: '当前首发输入 $0.02/百万 Token；刊例 $0.04/百万 Token；缓存读取与输出不计费',
    sourceUrl: 'https://docs.inceptionlabs.ai/get-started/models',
    note: 'mercury-decide；仅输入收费，首发五折结束日未列示；不支持聊天补全、流式输出或工具调用，未核实 AA 综合分。',
  },
  {
    vendor: 'OpenAI', model: 'GPT-6 Sol · Daybreak Blue', date: null,
    status: '受限访问；需组织审批和项目授权',
    pricing: '按所选底层模型计费；Daybreak Blue 不作为独立价格型号',
    sourceUrl: 'https://developers.openai.com/api/docs/guides/daybreak',
    note: 'gpt-6-sol 配合 daybreak_blue 访问计划；本次未核实此配置首次开放日期。未收录 AA 综合分，不能套用普通 GPT-6 Sol 的分数。',
  },
  {
    vendor: 'OpenAI', model: 'GPT-Rosalind Research', date: '2026-10-05',
    status: '获批生命科学研究用途；开始计费',
    pricing: '输入/缓存读/输出 $5/$0.50/$25，美元/百万 Token',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    note: 'gpt-rosalind-research；4 月 16 日首发研究预览；API 日志记 9 月 8 日受信 GA，原公告 9 月 11 日更新；此处日期为 10 月 5 日计费生效日。',
  },
  {
    vendor: 'Google', model: 'Antigravity Agent · 9 月预览', date: '2026-09-17',
    status: '智能体运行框架预览',
    pricing: '按底层 Gemini 推理计费；无独立基础模型 Token 单价',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/changelog',
    note: 'antigravity-preview-09-2026；替代 05-2026 预览版本；属于智能体运行框架，不作为新基础模型参与主图评分。',
  },
];
