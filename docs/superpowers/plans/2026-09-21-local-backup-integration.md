# Local backup integration plan

> **For agentic workers:** Execute with superpowers:executing-plans, then request a read-only whole-branch review before merging.

**Goal:** Integrate the verified local backup into main through a reviewed pull request.

**Architecture:** Merge the local snapshot at `02ce604` into `aa4d56d` (main), preserving both histories. Keep the cloud research runtime and deployment fixes from main, and add the local ETF monitor, parallel CDS pricing, compute history, reports, and newer tracked data.

**Tech Stack:** React/TypeScript, Express, Cloudflare Workers, Python/FastAPI, SQLite, QuantLib.

**Spec:** User request on 2026-09-21 to integrate, test, review, open a PR, and merge the backed-up local project.

## Global constraints

- Work in an isolated checkout; preserve the active local server checkout and private recovery backup.
- Retain main's cloud research routing, access control, deployment configuration, USD pricing, ARR history, and offline 52-week OpenRouter validation.
- Include only tracked project content; do not add environment credentials or ignored runtime databases.
- Do not merge unrelated open PRs or deploy production resources as a separate action.

## Review focus

- Local ETF startup must coexist with the main web server and cloud research development routing.
- Main's offline OpenRouter chart and complete 52-week validation must remain covered by its existing tests.
- Snapshot refresh must retain actual compute price history and last-good CDS data.
- ETF notification retries and watchdog handling must not duplicate delivery or leave polling permanently stalled.
- Cloud research access control, publishing, and refresh jobs must retain their existing Worker coverage.

## Tasks

- [x] Fetch both branches and run main's Node/TypeScript baseline suite: 312 passed.
- [x] Merge histories and resolve nine conflicts: combine startup scripts and documentation; retain main's OpenRouter implementation/tests; preserve local compute-history and CDS additions; use the newer local data snapshot (ARR observations match main, apart from correctly aged stale flags).
- [x] Run all Node/TypeScript tests, frontend build, Worker tests, ETF tests, CDS engine tests, and Python research tests: 354 Node/TypeScript, 38 Worker, 138 ETF, 10 CDS, and 84 research/legacy Python tests passed. The initial two news-test failures were missing ignored Python environments in the isolated checkout; providing the existing project environments resolved both, without changing production code. The real ETF watchdog/restart test also passed without skipping.
- [ ] Review the final diff independently and address actionable findings.
- [ ] Push the integration branch, create a PR against main, verify available checks, and merge the reviewed commit.
- [ ] Confirm GitHub reports the PR merged and main contains the integrated source history.
