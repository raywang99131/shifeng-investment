# Task 6 report — authenticated collector APIs

## Implementation

- Added the protected HTTP API: latest complete batch, revision-safe history, collector health, and raw audit export. Only `GET /healthz` is anonymous.
- Added separate read/write bearer roles. The only accepted credential format is `Authorization: Bearer <token>`; both values are SHA-256 hashed and compared with a full 32-byte XOR accumulation.
- All `/internal` writes authenticate before being forwarded to the fixed `ice-cds-global-v1` Durable Object. The Internet-facing API handler has no D1 write call.
- Added bounded JSON-body handling and strict seven-company manual-import validation (canonical companies/contracts, a single valid date, ICE/Treasury source hosts, valid curve and nodes). The Durable Object validates again, stores raw rows, invokes the existing publisher for that date, and records a `manual` run with the existing alarm/retry state semantics.
- Added a latest-batch projection that joins the immutable batch with all seven derived rows, preserving the fixed response shape and registry order.

## TDD evidence

### RED

`api.test.ts` was written before the API implementation. With the pre-task worker, every protected route returned the existing `404`, while the tests required the new protected contracts:

```sh
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run test:ice-cds-worker -- api.test.ts
```

Expected failure examples: anonymous `/v1/cds/latest` returned `404` rather than `401`; an authenticated latest request and paginated history/export routes returned `404`; and the internal import route returned `404`.

### GREEN

The API tests cover anonymous access, malformed Bearer syntax, separate read/write roles, fixed latest output, stable safe errors, date/cursor/limit validation, the 366-date cap, equal-date revision pagination, raw audit pagination, Durable-Object manual import, and malformed/oversized import bodies.

```sh
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run test:ice-cds-worker -- api.test.ts
```

Result: `1` file / `9` tests passed.

## Verification

```sh
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run test:ice-cds-worker
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run typecheck:ice-cds-worker
git diff --check
```

Result: Worker suite `8` files / `67` tests passed; typecheck and diff check passed.

## Files

- `cloudflare/ice-cds-collector/src/api.ts`
- `cloudflare/ice-cds-collector/src/auth.ts`
- `cloudflare/ice-cds-collector/src/manualImport.ts`
- `cloudflare/ice-cds-collector/src/collector.ts`
- `cloudflare/ice-cds-collector/src/index.ts`
- `cloudflare/ice-cds-collector/src/publisher.ts`
- `cloudflare/ice-cds-collector/src/repository.ts`
- `cloudflare/ice-cds-collector/src/types.ts`
- `cloudflare/ice-cds-collector/wrangler.test.jsonc`
- `cloudflare/ice-cds-collector/test/api.test.ts`

Committed implementation: `45e84c39dd81a1b038a930d2d151ce6705529b86 feat(cds): expose authenticated collector APIs`.

## Self-review and concerns

- `READ_TOKEN` and `WRITE_TOKEN` have distinct authorization paths; a write token cannot read and a read token cannot write.
- Error bodies never include database SQL, credentials, or upstream response content. Data-store or Durable-Object failures use stable `503`/`502` errors.
- The repository remains read-only from `api.ts`; manual import, manual collection, Alarm, and later seeding all use the same named Durable Object ordering domain.
- Tests use only fixed ICE/Treasury fixtures. No live upstream request was added.

## Fix round 1/5 — API and ordering-boundary hardening

### Review findings addressed

1. `CdsCollector` now owns a promise queue. Alarm, `ensure-alarm`, manual import, `collect-now`, and any future internal route dispatched through `fetch()` enter exactly one workflow at a time. The delayed-source concurrency test proves an `ensure-alarm` request cannot complete while a collection is paused on source I/O.
2. Added shared `readBoundedJson()`. It verifies exact `application/json`, rejects malformed/negative/over-limit `Content-Length`, streams with a cumulative 128 KiB ceiling, cancels oversized streams, and is applied by both the public API and the Durable Object.
3. History now exposes complete immutable seven-company snapshots, retaining the date/revision composite cursor. Audit export is section/key cursor based and includes raw revisions, raw current pointers, curves with nodes, derived spreads, batches with rows, batch-current pointers, and screenshot seed history.
4. Manual import now accepts only exact canonical object shapes and fixed source paths; validates registry aliases and time bounds; rejects extras; and recomputes ICE hashes, Treasury hashes, and content-addressed curve IDs. Treasury curve storage is append/verify immutable: matching concurrent replays succeed, while a reused identity with changed content cannot alter stored nodes.
5. Empty tokens and constant-time-equal read/write tokens now fail closed before role authentication.
6. Latest batch validation now checks the exact registry-ordered seven-company set, uniqueness, quality, and that every batch-row company equals its linked spread company.

### TDD and debugging evidence

New API security tests were added before these implementation changes. They initially failed because history returned headers only, export returned only raw ICE rows, equal read/write tokens authenticated, and a malformed latest row remained visible.

The final full run initially exposed a real concurrent curve insertion defect: two identical first-time publisher calls both observed an absent curve and one hit `UNIQUE constraint failed: treasury_curves.curve_id`. Root cause was the check-then-insert boundary introduced for immutability. The minimal correction is an atomic D1 batch using `ON CONFLICT DO NOTHING`, followed by exact immutable verification. The existing concurrent publisher regression and a new changed-node collision regression both pass.

### Verification

```sh
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run test:ice-cds-worker -- api.test.ts body.test.ts collector.test.ts repository.test.ts
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run test:ice-cds-worker
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run typecheck:ice-cds-worker
git diff --check
```

Results: focused suite `4` files / `32` tests passed; full Worker suite `9` files / `74` tests passed; typecheck and diff check passed.

Fix commit: `4c05d3085eac118727a38a67d551b831349c0726 fix(cds): harden collector API boundaries`.

## Fix round 2/5 — snapshot-consistent exports and canonical Treasury inputs

### Review findings addressed

1. Export cursors are now versioned, typed, and fully validated after Base64 decoding. The first page captures per-table append-only `rowid` watermarks plus SHA-256 fingerprints for both mutable pointer tables. Later pages read only rows at or below those watermarks and verify the pointer fingerprints before and after a page. Invalid inner cursors return `400 INVALID_REQUEST`; pointer changes return `409 EXPORT_SNAPSHOT_CHANGED`, requiring a fresh export instead of yielding a mixed reconstruction.
2. Treasury source label, maturity grid, validation, payload hash, and content-addressed curve builder are exported from the automatic Treasury adapter and reused by manual import. Manual input must use the exact label/source, all ordered maturities, and finite rates. A manually supplied automatic curve canonicalizes to the same curve ID/hash; fabricated grids and changed labels are rejected before storage.
3. Shared latest/history snapshot assembly now validates batch quality, linked spread quality, linked spread clearing date, company equality, and the exact registry ordered set. Cross-date and non-model-linked corruption is rejected consistently from latest and history.

### TDD evidence

New tests were added before the implementation for malformed decoded cursor payloads, insertion between export pages, mutable-pointer mutation between pages, cross-date/bad-quality batch links, and automatic/manual Treasury identity parity. Before the changes, a later raw revision appeared in an in-flight export, pointer mutation still returned `200`, and historical snapshots did not reject cross-date links.

### Verification

```sh
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run test:ice-cds-worker -- api.test.ts manualImport.test.ts body.test.ts repository.test.ts collector.test.ts
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run test:ice-cds-worker
MINIFLARE_WORKERD_PATH=/private/tmp/ice-cds-workerd-x64/package/bin/workerd npm run typecheck:ice-cds-worker
git diff --check
```

Results: focused suite `5` files / `38` tests passed; full Worker suite `10` files / `80` tests passed; typecheck and diff check passed.

Fix commit: `e4fdd789a5bbac0354304ca5950f9f479c3a8152 fix(cds): stabilize audit export snapshots`.

## Fix round 3/5 — atomic export baseline

### Review findings addressed

1. Initial audit-export watermarks and both mutable current-pointer maps are now captured in one `D1Database.batch()` read snapshot. Pointer SHA-256 fingerprints are computed only after that atomic read. This prevents a publication committed between independent reads from producing a permanently hybrid cursor.
2. Current-pointer validation also uses one two-query D1 batch, so its two hashes always describe the same pointer state.
3. Export cursors now require exact root, watermark, and pointer key sets; numeric keys must be safe non-negative integers and cannot exceed the watermark for their section.
4. Date linkage and batch-quality corruption are exercised separately, with both `/latest` and `/history` expected to fail safely.

### TDD evidence

Added a controlled concurrent-publication regression: a complete corrected collection commits immediately after the baseline D1 batch. The captured first cursor remains the complete old watermark set (not old raw rows mixed with new derived/batch rows); production pointer validation would instead return a clean retryable snapshot-change response. New API cases also prove extra cursor keys, bad types, and out-of-bound section keys return `400`.

### Verification

Focused API/repository/collector: 3 files / 37 tests passed. Full Worker suite: 10 files / 83 tests passed. Typecheck and `git diff --check` passed.

### Self-review

- The API remains read-only for all read routes; this change adds no writable request path or network use.
- The test uses only local fixed ICE/Treasury fixtures and a local D1 proxy. It intentionally freezes the initial pointer reads solely to inspect a successful first cursor after a simulated writer commit; production does not freeze them and responds with `409 EXPORT_SNAPSHOT_CHANGED` when the pointers change.
