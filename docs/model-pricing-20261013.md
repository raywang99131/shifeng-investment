# Model pricing and intelligence refresh — 2026-10-13

The original 29-model transcription remains selectable and unchanged. The default refreshed chart has 45 distinct models, including 16 additions. AA Intelligence Index v4.3.2 was checked for all 41 scored rows; four unscored models remain null. Exact source scores, configuration suffixes and model links are retained in `flagshipAaVerified.ts`. Model discovery covered AA entries since September 1 and vendor release/price pages through October 13; it is a dated review, not a promise of exhaustive live coverage.

The chart uses vendor USD tariffs where available, distinguishes promotional/list rates and context/time-of-day tiers, and leaves unverified hosted tariffs empty. Ling 3.1 Flash is explicitly temporarily free; open weights do not imply a free hosted API. Ling VL/Fin first-party CNY prices and third-party USD quotes are explained separately. Official launch dates are distinct from AA record dates. Gemini 3.7 Flash is routed to 3.8; DeepSeek V4 Pro continues to be offered with unchanged pricing per the latest Change Log, superseding the old September 10 news announcement.

Seventeen specialist model/access/service updates retain their own image/audio/hour/character/token units. Nine recently reviewed model records and Kimi Code monthly/annual subscriptions are also added to the original website price tables. Collected quotes with a newer or unknown date retain precedence over dated manual supplements.

- Website: https://www.shifeng-investment.com/ai-dashboard (AA 指数与成本; 模型价格)
- Feishu chart and editable source data: https://xcn0zaydz11m.feishu.cn/sheets/F9W3s5BBEhRRV8tdZvCchEAfnCf?sheet=BmbNjq (M1:Y46; specialist details M49:S66)
- Feishu original price table: https://xcn0zaydz11m.feishu.cn/sheets/F9W3s5BBEhRRV8tdZvCchEAfnCf?sheet=5pGMgJ (supplements A103:K113, subscriptions A116:H119)
- Export assets: `public/assets/research/model-api-intelligence-current-2026-10-13.{csv,svg,png}`. SVG comes from the rendered website; CSV includes per-row price and AA URLs, configurations, dates and conditions.

Validation: 18 data/view-model tests; TypeScript production build; scoped lint; desktop and 390px viewport review; Feishu saved-state reload verification. Publish with the existing `wrangler.jsonc` configuration and retained variables; never use the unrelated root tunnel deployment workflow.
