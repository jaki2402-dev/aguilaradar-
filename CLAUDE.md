# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo. Facts and traps only — read a section, act on it.

## What this is

Static crypto radar: market analysis, timestamped verdicts, a self-correcting backtest engine, plus:
- **Portfolio tab** (`data/portfolio.json`, since 2026-08-25) — live value/P&L from the engine's own verdicts.
- **Weekly fundamental thesis** (`data/portfolio-thesis.json`, since 2026-08-26) — real web research by a routine, never the engine or chat AI.
- **Allocation ranking** (`js/allocation.js`, since 2026-09-07) — verdict + weekly thesis only, "donnée non disponible" for anything else; a Portfolio card + AI-relay grounding.

Built separate from Horizon (a local, hand-deployed dashboard, not a repo) because aguilaradar held no € amounts. Reversed for the Portfolio tab only (Horizon's price precision was bad): qty/invested is manually declared by the user, never inferred or wallet-connected. The repo is public, so these numbers are exposed like every other `data/*.json` — deliberate, not an oversight.

**Architecture** (never depends on a credit system running out):
- Hosting: GitHub Pages, static files, no build/server.
- Automation: Cowork routines write `data/*.json` + commit. Frontend only renders — never computes verdicts/opportunities itself.
- Database: this git repo — appended, never overwritten/reset.

**Cadence**: instant client-side (prices/charts, live on every open) vs scheduled deep-cycle (verdicts/screening/backtest — quant pulse 5-15min, deep cycle 4h, halved from 2h on 2026-09-06 for token cost). `aguilaradar-watchdog-cycle-2h` (auto-recovery) was disabled same day — hardcoded to the old 2h threshold, can't be edited externally — so a stuck cycle now only shows via the freshness indicator, no auto-retry.

## Commands

```
npm install && npm test                          # full suite (Vitest + jsdom)
npm run test:watch                                # watch mode
npx vitest run test/engine.test.js                # one file
npx vitest run test/engine.test.js -t "name"      # one test
```

No build/lint step — devDependencies exist only for tests; the deployed site is raw `js/`/`css/`/`data/`/`index.html`. CI (`.github/workflows/tests.yml`): `npm ci && npm test` on every push to `main` and on PRs.

## Architecture

### No modules — shared global scope

`js/*.js` are plain `<script>` tags, one shared scope, **not** ES modules — a top-level `const`/`let` in one file is readable by files loaded after it in `index.html`'s order. Wrong order = broken at load time.

Tests inject real `<script>` tags (`test/helpers/loadPage.js`), never `eval` (eval gives each call its own scope, breaks `const`/`let` sharing — verified). `loadScripts(dom, [...])` must match `index.html`'s order. Use `setGlobal`/`getGlobal` to poke top-level `const`/`let` — plain `dom.window.name = value` doesn't work for those. Out of scope for tests: `background-fx.js` (decorative), real network calls.

### `js/config.js` — single config source

`FAVORIS`, `SECTORS`/`SECTOR_COLORS`, `REFRESH`, `THRESHOLDS`, `DATA_URLS`, `escapeHtml`/`safeUrl`. Never hardcode config elsewhere.

- **CoinGecko IDs are verified via `/api/v3/search`, never guessed** — a plausible-but-wrong ID silently pulls the wrong asset. Trap already hit: id `flux` is a *different* token (Datamine FLUX); this project's Flux/Zelcash is `zelcash`. Horizon may still have this wrong.
- **`THRESHOLDS.directionalMovePct` is the ONE directional-move threshold, used everywhere.** A prior prototype used different thresholds per view (±3% vs ±10%) and made numbers incomparable — don't repeat that.

### Trust boundary

News, AI text, and the public CoinGecko API are untrusted for rendering: `escapeHtml()` before `innerHTML`; `safeUrl()` (blocks `javascript:`/`data:`) before any such URL becomes `href`.

### `highlightKeyInfo()` (`config.js`) — long analysis text, not bare escape

Verdict reasoning, portfolio thesis, correction log, digest, etc. go through this instead of bare `escapeHtml()` — escapes first (safe to swap either way), then wraps figures (%, $, €, "1,1 %") in `.hl-stat` and `Bull:`/`Base:`/`Bear:` in color-coded `.hl-scenario` spans, so dense text can be scanned (mobile complaint, 2026-08-31). Skipped only for browser push bodies (`notify.js`) — Notification API doesn't render HTML.

Two silent-breakage traps:
- **`<span>`, never `<strong>`, for the scenario label** — several blocks style every `<strong>` in their container as a block-level label; `<strong>` here would break mid-sentence onto its own line.
- **Number regex separates thousands-space from decimal-comma/period** (`\d{1,3}(?:\s\d{3})*(?:[.,]\d+)?`) — a simpler `[\d\s.,]+` pattern splits "1,1 %" into "1," + "1 %". Regression test: `config.test.js`.

Assistant (`appendChatMessage`): only `role === "assistant"` gets highlighted; the user's own message stays `textContent`, never parsed as HTML. Regression test: `assistant.test.js`.

### Access portal — a filter, not security

`js/auth.js` + `ACCESS_HASH` gate the UI behind a SHA-256 code. Repo is **public**, so the hash is visible and every `data/*.json` is fetchable directly regardless of the portal. Stops a casual visitor, not a determined one.

### AI relay (`cloudflare-worker/`) — AI-first, not last resort

Assistant order: **factual sourced data first** (tracked verdict, glossary, live CoinGecko lookup) → else the AI relay (`fetchLiveAiFallback()`) **before** any keyword match. Keyword-matching (`CHAT_INTENTS`) is a fallback for when the relay is down/fails only — a keyword answering *instead of* reading the question was the exact bug users reported.

Calls a Cloudflare Worker on Workers AI (free tier), grounded only in real site data. `AI_RELAY_URL` unconfigured (default placeholder) = never calls out, falls to keyword fallback.

**Deploy gotcha:** Worker source lives in `cloudflare-worker/` *here*, but Cloudflare Workers Builds watches a **separate repo**, `jaki2402-dev/aguilaradar-assistant-ia`. A push to `main` here changes nothing live until that repo is *also* updated (clone, copy `worker.js`/`wrangler.jsonc`/`package.json`/`README.md`, commit, push). Auto-deploy is **inconsistent, not simply broken** — confirmed unsynced 5+ days once, auto-deployed instantly another time, auto-deployed in minutes on 2026-09-07. Always **verify with `workers_get_worker_code`** after pushing there, don't assume.

**Response modes** (`detectResponseMode`, since 2026-09-07): the relay picks one of 4 formats — quick/allocation/comparison/thesis (`CORE_RULES`+`FORMAT_*`, `worker.js`) — via a client-side `responseMode` hint. Only a hint: the Worker's prompt describes all 4 branches, model self-selects from the real question either way. `max_tokens`: 250 quick, 900 the rest. A question naming 2+ favoris (comparison) routes **before** the single-asset short-circuit — `findAssetMention()` only returns the *first* match, so without this a real comparison got just one asset's sheet. Comparisons/single-favori opinions also get that asset's long-term fundamentals (`favoris-context.json`) injected — targeted to the 1-3 assets named, never all 15 (context budget: 20000 chars).

### `POST /transaction` — Worker's 2nd role (added 2026-09-02)

Portfolio buy/sell form (`saveTransaction()`) writes `qty`/`invested` to `data/portfolio.json` via GitHub Contents API, gated by `X-Portfolio-Secret` vs. the `PORTFOLIO_WRITE_SECRET` Cloudflare secret. Same security class as `ACCESS_HASH` — casual-visitor filter only, acceptable since `portfolio.json` is a declared simulation and every write is a reversible commit. Needs `GITHUB_WRITE_TOKEN` (fine-grained PAT, **only** this repo, Contents R/W), `PORTFOLIO_WRITE_SECRET`, `PORTFOLIO_WRITE_URL` — until all set, `portfolioWriteConfigured()` gates the button off. Rate-limited 20/hour via `PUSH_STATE` KV.

**Any new request header here needs an entry in `corsHeaders()`'s `Access-Control-Allow-Headers`**, or it looks like a dead network, not an HTTP error: a missing header makes the browser's CORS preflight block the request before it's ever sent — nothing reaches the Worker, nothing logs, frontend just sees `TypeError: Failed to fetch`. Shipped exactly that bug once (2026-09-02): a Node smoke test calling the handler directly went green because it never exercises real browser CORS. Only a real browser round-trip confirms a fix here.

**Achat/vente/correction, keep symmetric** (real gap, fixed 2026-09-07): `computeTransactionResult()`/`renderTransactionCalculator()` (`js/portfolio.js` — the Worker above only commits the already-computed `qty`/`invested`, never calculates) support achat, vente, and **correction** (types final `qty`+`invested` directly, bypassing the calc — the only fix for a mis-entered transaction, since no per-transaction log exists anywhere, only this running total). `investedOverride` (the "montant investi" field) was achat-only at first — hidden entirely on vente, reasoning "a sale doesn't need a typed amount." True for the *default* calc (cost-basis proportional to qty sold, never the sale price) but false for *overriding* that default: exactly as legitimate on a sell as a buy (fees, a lot at a different cost), so it's optional on both now. **Still a cost-basis amount removed on vente, never the sale price/proceeds** — `computePortfolioSummary`'s P&L math assumes `invested` never means cash received. General trap, not just this form: don't ship one direction of a paired feature (achat/vente, or any other mirror-image pair in this codebase) and leave the other silently incomplete without a stated reason — there wasn't one here, it was just unfinished.

### Data files (`data/*.json`)

Written by routines, not the frontend. **Append-only, never overwrite:**
- `verdicts.json` — `status` moves `"pending"`→`"resolved"` only once `resolves_at` passes. Show "pending", never invent an early outcome.
- `engine-history.json`'s `correction_log` — every self-adjustment attempt, the engine's cross-run memory. `global_stats` (same file) recomputes each cycle from resolved verdicts.

`opportunities.json`: Top-300, "Meme" excluded. `alerts.json`: threshold-driven (RSI, S/R, order-book), independent of the deep cycle. Since 2026-09-07: a `seuil_technique` alert on a favori gets a cross-referenced note (`contextualizeAlert`, `js/allocation.js`) only on a genuine divergence from the weekly thesis — never when they agree.

`portfolio.json` — **the one exception**: edited by hand (human, or Claude on explicit request), no routine writes qty/invested; `js/portfolio.js` only reads to compute value/P&L, never stores a number back. `qty`/`invested: null` + `pending: true` = not provided yet — render pending, never guess.

`portfolio-thesis.json` (2026-08-26) — **the one file a routine writes directly**: real web-researched medium-term view, distinct from the engine's ~14-day technical verdict (never confuse the two). Shape: `{generated_at, positions: {<cgId>: {recommendation, conviction, constat}}}`, `recommendation` ∈ Renforcer/Conserver/Attendre/Réduire (`normalizeRecommendation()` maps to a badge slug, else plain text, never invents a badge). No entry/file = no thesis yet — render nothing.

`favoris-context.json` — **keyed by ticker, not `cgId`** (the one file that isn't). Shape: `competitor`, `long_term_thesis` (`bull`/`base`/`bear`), `open_interest`, `defi_tvl`, `onchain_signal`. Rendered as "Thèse long terme" in `renderFavorisContextSection` (Portfolio/Favoris/Opportunités) — **not** `portfolio-thesis.json` above. **Real mix-up already happened (2026-08-31):** a complaint got fixed against the wrong file first (right name, wrong shape). Tell apart by **shape**: single `constat` + badge → `portfolio-thesis.json`; `bull`/`base`/`bear` split, no badge → `favoris-context.json`.

**Cowork routines gotcha** (same shape as the Worker one): `briefing-crypto-hebdo-cloud` (weekly) and `alerte-crypto-quotidienne-cloud` (4h) email the portfolio and live entirely as Cowork trigger config — not files here, invisible to `git log`. Confirmed 2026-09-07: also **not readable** via `list_triggers`/`update_trigger` (write-only, full replacement, no read-back) — check actual email output (Gmail) or ask the user to paste the prompt. Both read `portfolio.json` read-only; `briefing-crypto-hebdo-cloud` also has git write access, scoped **only** to `portfolio-thesis.json` weekly. `aguilaradar-briefing-email-quotidien` (daily) reads `digest.json`/`alerts.json`/`engine-history.json`, portfolio-free, read-only.

### Readability (WCAG AA), audited 2026-09-07

Palette (`:root`, `css/style.css`) was checked by real contrast-ratio math, not eyeballing — 2 real failures found and fixed: `--text-faint` (was 3.0-3.4:1, now `#7e8ba3` ≥4.5:1) and `.notif-bell-badge` (white on `--loss` was 3.42:1, now its own `#c22a22` background). If you change a color token or add white/light text on a colored background, check contrast — this palette has no other known failures, don't reintroduce one silently.
