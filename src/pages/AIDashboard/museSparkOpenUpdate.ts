/** Independently checked supplement; the 2026-10-13 model and AA snapshots remain unchanged. */
export const MUSE_SPARK_OPEN_UPDATE = {
  id: 'muse-spark-open',
  vendor: 'Meta',
  model: 'Muse Spark Open',
  releasedAt: '2026-10-15',
  checkedAt: '2026-10-16',
  specificationNote: '816B 总参数 / 42B 激活参数，1M 上下文；输入文本、图像、视频和音频，输出文本。开放权重适用 Muse Model License，商业使用需遵守许可条件。',
  aa: { score: 39, indexVersion: '4.3.2', evaluationLabel: 'Xhigh' },
  hostedQuote: {
    provider: 'Baseten', currency: 'USD', input: 1.25, cacheRead: 0.15, output: 4.25,
    serviceTier: 'Baseten 第三方托管',
    sourceLabel: 'Baseten 官方报价（第三方托管）',
    note: 'Baseten 托管 API 的独立报价，不是 Meta 第一方刊例或 AA 中位数；开放权重不代表免费托管 API。',
  },
  sources: {
    release: { label: 'Meta 官方发布', url: 'https://research.meta.ai/blog/muse-spark-open' },
    weights: { label: 'Meta 官方 Hugging Face 模型卡', url: 'https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B' },
    aa: { label: 'Artificial Analysis · Xhigh · v4.3.2', url: 'https://artificialanalysis.ai/models/muse-spark-open' },
    pricing: { label: 'Baseten 官方托管报价', url: 'https://www.baseten.co/library/muse-spark-open/' },
    tweet: { label: 'AI at Meta 官方推文', url: 'https://x.com/AIatMeta/status/2110779754274292212' },
  },
} as const;
