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

### Data reliability layer (`js/data-integrity.js`, since 2026-09-14)

Pure functions, no DOM, no fetch — **flags, never corrects.** `freshnessStatusForDate`/`checkFavorisContextFreshness` judge each favori's `favoris-context.json` entry independently by its own `last_computed_at` (ok/warning/stale, same 3-state vocabulary as `FRESHNESS_SOURCES` in `app.js`, which only judges whole *files*, not per-asset entries — the two are complementary, not redundant). `checkVerdictPlausibility` only catches physically-impossible values (`confidence_pct` outside 0-100, non-positive `horizon_days`/`price_at_issue`) — never a judgment on verdict *quality*. Surfaced in two places: a `.freshness-chip` badge next to "Contexte élargi" per favori (`detail.js`), and a "Cohérence des données" block in Moteur → Santé technique (`insights.js:renderDataIntegritySummary`). First real finding from this (2026-09-14): 11/15 favoris had gone 14-26 days without a refresh — the rotation `aguilaradar-favoris-quotidien` is supposed to do wasn't actually enforcing a bound; see `docs/routines/favoris-quotidien.md`.

### On-chain data (`js/onchain.js`, since 2026-09-14)

Two tiers, same "instant vs deep-cycle" split as the rest of the site. **Direct** (`fetchBtcOnchainLive`): 4 client-side fetches (DefiLlama TVL, mempool.space fees/mempool, Blockchain.com tx/day) on fiche open, each independently null on failure — same discipline as `prices.js`. **Historical** (`renderMetricHistoryChart`): reads `data/onchain-history.json`, real daily snapshots only, `< 2` real points in the selected horizon (1m/3m/6m/1y tabs) renders "Historique insuffisant", never an interpolated/fabricated line. **BTC only** — the only favori with stable free no-key public APIs for these exact metrics.

Two traps hit and fixed while building this (2026-09-14), both worth generalizing:
- **A `Promise.all` entry that can reject takes down every other entry with it.** The on-chain section was first fetched *inside* `renderTechnicalSection`'s `Promise.all` alongside the price-chart fetch — when the price fetch failed (network/rate-limit), the whole section vanished even though the on-chain fetch itself never failed. Fixed by giving on-chain its own independent `try`/`catch` in `renderDetailPanel`, sibling to (not nested in) the technical section. Any future fetch with a *different* failure mode than its neighbors needs its own isolation, not a shared `Promise.all`.
- **A `<button>`/`<a>` inside a `.favori-tile`/`.journal-entry`-style clickable card needs `e.stopPropagation()` on its own click handler**, or the click bubbles to `attachDetailToggle`'s card-level listener and collapses the whole card instead of doing its own thing — same root cause `renderClampableText`'s "Lire plus" already works around (see its comment in `app.js`), re-hit here for the on-chain horizon tabs (`wireOnchainChartTabs`). Only caught by a real browser click in Playwright, not by `npm test` (jsdom tests exercised the tab-rendering function in isolation, never the full click-bubbles-through-the-real-card path).

### Verdict breakdown (`js/verdict-breakdown.js`, since 2026-09-14) — 5 categories, never a combined score

`computeVerdictBreakdown`/`renderVerdictBreakdown`, referenced by `docs/verdict-methodology.md` (the two must stay in sync — a category's scoring rule changes in both places together). Momentum/Fondamentaux are 0-10 scores; Valorisation/Tokenomics are raw ratios (`{ratio}`/`{circulatingPct}`, never forced onto a 0-10 scale — no historical range exists yet to say what "good" means); Risque is qualitative (`faible`/`modéré`/`élevé`, **never** "Donnée insuffisante" — absence of a bad signal is itself the information, the one category where that's true). **No global/combined score anywhere, ever, while any category is "Donnée insuffisante"** — same rule as `allocation.js`.

Tokenomics (`scoreTokenomics`) was always `null` until 2026-09-14 (no source). Now: `circulating_supply`/`max_supply` (CoinGecko `/coins/markets`, `fetchFavorisSupply()` in `prices.js`) give a real "% of max supply already circulating" — fetched **once at load, not on the 60s price tick** (supply doesn't move minute to minute), in its own isolated `try`/`catch` (same on-chain-Promise.all lesson above — never merge it into `refreshPrices()` or `loadAllData`'s `Promise.all`). An asset with no `max_supply` (6/15 favoris as of 2026-09-14: ETH, INJ, TIA, GRT, AIOZ, LPT) renders **"Offre non plafonnée," never "Donnée insuffisante"** — absence of a cap is a real known fact, not missing data, same logic as Risque above. Still missing: team/insider allocation, precise unlock calendar — `circulating/max` alone doesn't capture those; that's real web research, deliberately left to the `favoris-quotidien` routine rather than guessed here.

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

`onchain-history.json` (2026-09-14) — real daily on-chain snapshots, BTC only for now. Shape: `{assets: {bitcoin: {snapshots: [{date, computed_at, tvl_usd, tx_per_day, active_addresses, source: {...}}]}}}`, append-only, **a day is skipped entirely (never a null-filled row) if none of the 3 metrics could be confirmed** that cycle. Ships empty (`snapshots: []`) — charts show "Historique insuffisant" until real points accumulate; do not backfill.

**Cowork routines gotcha** (same shape as the Worker one): routine automation lives entirely as Cowork trigger config, not files here — invisible to `git log` and **not readable** via `list_triggers`/`update_trigger` (write-only, full replacement, no read-back, reconfirmed 2026-09-14). `briefing-crypto-hebdo-cloud` (weekly) and `alerte-crypto-quotidienne-cloud` (4h) email the portfolio; both read `portfolio.json` read-only. `briefing-crypto-hebdo-cloud` also has git write access, scoped **only** to `portfolio-thesis.json` weekly. `aguilaradar-briefing-email-quotidien` (daily) reads `digest.json`/`alerts.json`/`engine-history.json`, portfolio-free, read-only.

**`docs/routines/*.md` (started 2026-09-14) — the workaround for "invisible to git log."** A routine's live prompt still can't be read back, but nothing stops writing (and keeping current) a versioned spec it's told to follow — `aguilaradar-favoris-quotidien`'s prompt is now a short pointer: "read `docs/routines/favoris-quotidien.md` and follow it exactly." Changing that routine's actual procedure going forward means editing the `.md` + committing, **not** another blind `update_trigger` overwrite. Extend this pattern to other routines rather than reintroducing an unversioned prompt. Caveat: the pointed-to file must exist on the branch the routine actually reads (`main` — confirmed via its `session_request.sources` in `get_session`), not just on a feature branch.

`aguilaradar-cycle-2h` (the verdict-writing routine) got the same treatment same day — prompt now points to `docs/routines/cycle-2h-verdict.md` (+ `docs/verdict-methodology.md` for the `confidence_pct` formula). Reason it mattered enough to touch the riskiest routine in the project: `global_stats.accuracy_strict_pct` was **26.83%, below the 42.9% majority-class baseline** — the engine was doing worse than guessing the same class every time — and `confidence_pct` across all 56 verdicts was 88% concentrated on two round numbers (50/60), i.e. picked by feel, not derived. The revision ties `confidence_pct` to `signal_consensus.accord_count` and requires cross-checking `favoris-context.json`/`portfolio-thesis.json` before finalizing a verdict; it deliberately leaves `threshold_pct` fixed and the working `corr-20260906` horizon-adaptation/`correction_log` mechanics untouched.

**Every routine commit needs a 2nd step, or it's invisible on the live site** (found 2026-09-14, first real run of the revised `cycle-2h` prompt): a routine session commits to its **own outcome branch** (`session_context.outcomes[].git_repository`, e.g. `claude/compassionate-ritchie-rvj6fv` — a per-session branch, not `main`), confirmed via `get_session`. A working cycle does a **2nd commit**: merges that branch into `main` and pushes `main` (verified by diffing a known-good pair, `0101615`/`8a0e2b3`, same author 39s apart, the 2nd commit's parents = old `main` HEAD + the 1st commit). The revised `cycle-2h` prompt's first run did step 1 correctly (good `confidence_pct`, correct cross-referencing) but **never did step 2** — sat unmerged until fixed by hand. "Push it to main" alone is not a sufficient instruction; both `docs/routines/*.md` files now spell out the 2-step merge explicitly. If a future cycle's expected data changes aren't showing up on the live site, check for an orphaned `claude/*` outcome branch ahead of `main` before assuming the routine didn't run.

**Usage cap, not a bug** (found 2026-09-14): 2 of the 12 `aguilaradar-*` routines failed back-to-back (`groupe-temoin-hebdo` 09-13, `sante-quotidien` 09-14) on `rate_limit_info.status:"rejected"` — 7-day and 5-hour caps respectively, visible via `get_session` on the failed run's `session_id`, both self-resolved on the next scheduled fire. Not a prompt/data bug. Real constraint though: 12 standing routines already push close to the weekly cap — don't add a 13th without retiring/merging one first, and keep routine prompts lean rather than padding them.

### Readability (WCAG AA), audited 2026-09-07

Palette (`:root`, `css/style.css`) was checked by real contrast-ratio math, not eyeballing — 2 real failures found and fixed: `--text-faint` (was 3.0-3.4:1, now `#7e8ba3` ≥4.5:1) and `.notif-bell-badge` (white on `--loss` was 3.42:1, now its own `#c22a22` background). If you change a color token or add white/light text on a colored background, check contrast — this palette has no other known failures, don't reintroduce one silently.

### Density pass (2026-09-14) — grid columns don't always shorten the page, measure

User complaint was "too much scrolling"; desktop had real wasted-width cases (`.detail-context` on a favori's detail panel — Concurrent/Thèse/Open interest/TVL DeFi/Signal on-chain were 6 stacked full-width text blocks, now 2 sub-grids: `.detail-context-prose` 2-col ≥720px, `.detail-context-grid` 3-col ≥640px) fixed with real, measured wins. `#news-body`, `.alloc-rank-list` (Portfolio "Où placer ma prochaine recharge"), `.engine-tables-row` (confusion matrix + précision/rappel/F1 table) got the same grid-of-cards treatment as the existing `#journal-body`/`#notifications-body` idiom.

**Trap hit here**: a `<table>` inside a grid column reports its min-content width (wide enough that no cell wraps) to the grid track, which then widens the whole grid — and the page — past the viewport. `.engine-tables-row` did this at 390px until `min-width: 0` was added on the grid items (same fix already on `.detail-stat`, now on `.onchain-chart-card`/`.detail-context-card` too as a precaution) — **always verify a new grid at real phone width (390px), not just desktop**, `document.body.scrollWidth` catches it in one line.

**Tried and reverted**: forcing `.onchain-history-grid`/`.detail-context-grid` to 2 columns on mobile too (not just desktop) via a smaller `minmax()`. Measured on the real BTC detail panel: page went from 3978px to 4090px — the placeholder text ("Historique insuffisant...", BTC's long TVL DeFi note) wrapped onto so many narrow lines that the page got *longer*, not shorter. Narrower columns help only when content is already short; for genuinely long text, shortening the text (done: the "Historique insuffisant" message, -66px measured) beats forcing columns. Don't retry the same 130-150px minmax on this content without a similarly-measured reason to believe it'll go differently.

**Journal dedup**: `.journal-entry` (app.js) shows its full `reasoning` + verdict badge *before* being expanded — unlike a favori/opportunity tile (which only shows price/badge collapsed). `renderDetailPanel`'s "Mon avis" block used to repeat that same `reasoning` text a second time once expanded. Fixed with `skipOpinionBlock: true` passed from `renderJournalPage`'s `attachDetailToggle` call only — a card-type-specific flag, not a global change to `renderDetailPanel`, since Favoris/Opportunités/Portefeuille genuinely don't show reasoning before expansion and still need "Mon avis". Not caught by `npm test` (no test opened a journal entry's detail panel and read its content) — only a real click did.

### Expand/collapse panels never use a fixed `max-height` (found 2026-09-15, real user report)

`.detail-panel.open` and `.portfolio-tile.expanded .portfolio-tile-body` used the classic CSS "animate to a guessed max-height" technique (`max-height: 2400px` + `overflow: hidden` + `transition`). A real favori's detail (BTC: on-chain + contexte élargi + décomposition) can exceed any guessed ceiling, and `overflow: hidden` means the excess isn't just visually ugly, it's **unreachable — no scroll, page-level or inner, reveals it**. User reported exactly this ("je ne peux pas défiler pour lire le reste").

Fix: `attachDetailToggle` (`detail.js`)/`attachPortfolioToggle` (`portfolio.js`) set `element.style.maxHeight` inline to the real `scrollHeight`, never a constant. Two real traps hit *while fixing this*, both worth generalizing to any future async-loaded expandable:

- **Measure after starting the async render, same tick — never before.** `renderDetailPanel`/`loadPortfolioTechnical` both set a loading placeholder synchronously as their first line, before their first `await`. Measuring `scrollHeight` *before* calling them (rather than right after, same tick) captures the panel in whatever state it was in prior — on a first-ever open that's empty, giving `max-height: 0px` (panel fully invisible, a worse regression than the original bug). Caught only by a real Playwright run against a live-reloading server, not `npm test` (jsdom doesn't render real layout/height).
- **Re-measure unconditionally after the promise settles — success or failure.** The first fix skipped the post-load re-measure when the fetch failed (`if (!success) { loaded = false; return; }`), on the assumption a failed fetch leaves content unchanged. False: both functions replace the loading placeholder with a *different-height* error message even on failure. Skipping the re-measure there silently reintroduces the exact same clipping bug, just triggered by a rate-limited/offline API instead of by long content — and this path is common in production (every other fetch in this codebase treats API failure as routine, not exceptional).

Verified with a real sandboxed-network Playwright run (CoinGecko calls blocked, so the failure path above was exercised for real, not simulated) at 390px and 1440px: open → full content visible, no clip; close → collapses; reopen → still correct, no stale height.

### Freshness banner can cry wolf if a routine only touches its health field conditionally (found 2026-09-15)

`updateFreshnessIndicator` (`app.js`) reads a single field, `engine-history.json`'s `routine_health.last_success_at`, to judge whether the deep cycle (`aguilaradar-cycle-2h`) is still alive — by design (see the code comment there), so a genuinely stuck routine shows up even while other routines keep the rest of the site fresh. That only works if the field is touched on **every** successful cycle, including a "nothing due this cycle" one.

Real finding: on 2026-09-15 the banner read "la routine semble bloquée" (~17h since `last_success_at`), which looked alarming — but cross-checking `origin/main`'s actual `data/verdicts.json` showed the underlying work was current (`v-20260907-ctsi` correctly resolved and `v-20260914-ctsi` correctly reissued at 14/09 20:22 UTC, with the new `confidence_pct` formula and cross-referencing working exactly as designed). `routine_health.last_success_at` itself just hadn't been bumped by that cycle, or the ones after it — a gap between what the routine actually did and what it reported doing, not a stuck routine. **Always verify a freshness/staleness claim against the underlying data file's own timestamps on `origin/main` (not a local feature branch, which can be commits behind) before trusting a derived health indicator** — this is the second time in this project a freshness signal has been misleading in a different direction (see `data-integrity.js` above: 11/15 favoris silently stale despite no alarm; here: an alarm despite fresh data). `docs/routines/cycle-2h-verdict.md` should be made to say explicitly: touch `routine_health.last_success_at` at the end of *every* successful cycle, not only ones that emit/resolve a verdict.

**Unrelated, and confirmed benign while investigating this**: dozens of leftover `claude/compassionate-ritchie-*` branches exist on the repo (one per routine session's outcome branch) — sampled one (`w7lq7j`, the `0101615` commit already cited above) and confirmed it *is* an ancestor of `main`, i.e. already merged, just never deleted. Branch clutter, not evidence of missed merges — don't mistake the accumulation for a problem without checking `git merge-base --is-ancestor` first.
