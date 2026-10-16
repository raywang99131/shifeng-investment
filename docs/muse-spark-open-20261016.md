# Muse Spark Open supplement — 2026-10-16

The user supplied the [Meta announcement](https://x.com/AIatMeta/status/2110779754274292212). Muse Spark Open is recorded independently of Muse Spark 1.3, Muse Wonder and Wonder Full.

## Sources and scope

- [Meta research blog](https://research.meta.ai/blog/muse-spark-open) and [official model card](https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B): released October 15, 2026; 816B total / 42B active parameters, 1M context; text, image, video and audio input, text output. The tweet appeared October 16 at 01:08 Beijing time, which does not replace the official release date.
- Open weights use the Muse Model License with limited commercial terms. Open weights do not imply free hosted APIs. Wonder's closed distribution and Spark Open's open weights are described separately.
- [AA model page](https://artificialanalysis.ai/models/muse-spark-open), [October 15 changelog](https://artificialanalysis.ai/changelog) and [methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking): independent Xhigh score 39, v4.3.2. The vendor's benchmark table was not treated as the sole AA source.
- [Baseten official model API prices](https://www.baseten.co/library/muse-spark-open/): USD per million tokens, input 1.25, cache read 0.15, output 4.25. The specific third-party hosted quote is labeled as such; it is neither a Meta first-party tariff nor an AA provider median.

Website additions cover the original price table, the AA/price comparison and recent access updates. There are now 46 models, 42 scored entries and 19 access/specialist updates. The base review remains dated October 13; only Open has October 16 checked/as-of/retrieved dates. CSV exports retain each row's appropriate review date. The original 29-row transcription and historical 41-row AA snapshot remain unchanged. Spark 1.3's score and task cost were not copied, and the separate Spark 1.2 Benchmark registry was not renamed to Open.

New CSV, SVG and PNG assets: `public/assets/research/model-api-intelligence-current-2026-10-16.*`. SVG was captured from the rendered DOM and computed styles, then rasterized and visually checked. The browser download-event tool timed out; no successful download-event claim is made. Source screenshots, text and JSON are retained in the main workspace's `output/muse-spark-open-20261016`.

## Feishu

- [Original pricing worksheet](https://xcn0zaydz11m.feishu.cn/sheets/F9W3s5BBEhRRV8tdZvCchEAfnCf?sheet=5pGMgJ): appended A122:K130 after confirming the range was empty. Includes the independent model, quote, AA configuration, specifications, license, sources and date definitions.
- [Comparison worksheet](https://xcn0zaydz11m.feishu.cn/sheets/F9W3s5BBEhRRV8tdZvCchEAfnCf?sheet=BmbNjq): appended comparison record M47:Y47 and access record M68:V68. A2:A4 explains that the previous 45 source rows retain their October 13 dates/order, while the new picture and exports use the latest order. GLM-Legal and its blank price/index fields remain untouched.
- Replaced the floating picture at A6 with the 46-model chart and restored a readable width. The October 13 picture remains in the historical public assets. File-chooser upload encountered extension file-URL permission limits; the native system picker completed the upload without changing browser security settings.
- Cloud save was observed. Reloading both worksheets confirmed the new Open 39 / 1.25 / 4.25 picture and the original price row's 1.25 / 0.15 / 4.25 values persisted.

## Verification and release

All 94 frontend Node tests pass, scoped ESLint passes, and TypeScript/production build passes with the existing large-chunk warning. Browser preview verifies the independent hosted row, new summary and chart, and original/latest switching: Open is absent from the original and present in the latest. At a 390x844 viewport, document width is 384, chart container width 214 and local chart scroll width 1120; no page-level horizontal overflow. Preview console has no errors.

Before publishing, confirmed the active deployment was still this task's previous BofA version f311727c-78e2-47c8-8290-99ba447266ad. Published using `wrangler.jsonc --keep-vars`, preserving backend variables and the original workspace services. New deployment: **e555ba36-6270-47ac-99c1-7beb1e6ca5b4**, main bundle `index-CFsgqoox.js`; deployment tooling confirmed the production domain and Worker routes.

Production browser login returned **Your One-Time Pin has expired!** (ten-minute expiry), so production visual verification remains incomplete. Preview and Feishu verification are complete. Access control was not changed or bypassed.
