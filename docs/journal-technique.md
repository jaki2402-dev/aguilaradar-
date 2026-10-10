# Journal technique — archive détaillée (ex-CLAUDE.md complet au 2026-10-03)

Version intégrale, mot pour mot, de CLAUDE.md avant sa compaction du 2026-10-03 (économie de tokens : CLAUDE.md est chargé automatiquement dans CHAQUE session, routines comprises). CLAUDE.md garde les règles ; ce fichier garde le *pourquoi* et l'historique des incidents. À lire seulement quand une règle de CLAUDE.md renvoie ici.

---

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

### On-chain data (`js/onchain.js`, since 2026-09-14, extended 2026-09-15)

Two tiers, same "instant vs deep-cycle" split as the rest of the site. **Direct** (`fetchBtcOnchainLive`): 4 client-side fetches (DefiLlama TVL, mempool.space fees/mempool, Blockchain.com tx/day) on fiche open, each independently null on failure — same discipline as `prices.js`. **Historical** (`renderMetricHistoryChart`): reads `data/onchain-history.json`, real daily snapshots only, `< 2` real points in the selected horizon (1m/3m/6m/1y tabs) renders "Historique insuffisant", never an interpolated/fabricated line. **BTC is still the only favori with a "direct" (live, browser-fetched) tier** — its APIs are the only ones confirmed free/no-key/stable enough for that.

**Extended 2026-09-15 to all 15 favoris, at the "historical" tier only** (`ONCHAIN_OWN_CHAIN_ASSETS`/`ONCHAIN_NO_OWN_CHAIN_ASSETS`, `js/onchain.js`) — user asked for active-addresses/tx-per-day on every favori, not just BTC. Real research (not assumption) split the other 14 into three groups:
- **7 more own-chain assets** (`ethereum`, `arbitrum`, `celestia`, `injective-protocol`, `peaq-2`, `aioz-network`, `zelcash`/FLUX): get the historical chart tier, same as BTC, once `docs/routines/favoris-quotidien.md` §2 (extended same day) starts writing their snapshots. **No new "direct" tier for these** — deliberate: Blockscout (the natural EVM source for ETH/ARB) now requires a PRO API key for programmatic access as of Blockscout's own Oct-2026 policy change, so it no longer meets this project's "free, no-key, stable" bar for a browser fetch; the routine's own granted Blockscout MCP access sidesteps that (server-side, not subject to the same restriction) and also sidesteps an unverified CORS question a browser fetch would carry. ETH's `tx_per_day` via Blockscout's `/api/v2/stats/charts/transactions` was confirmed with a real call (real dates/volumes returned) while building this; ARB uses the identical product/endpoint but wasn't independently re-confirmed. The 5 non-EVM chains (Celestia/Injective/Peaq/AIOZ/Flux) have no source verified at all yet — real APIs found via WebSearch (Celenium for Celestia, RunOnFlux's explorer for Flux, etc.) but none test-called from a dev session, because **this session's outbound network is policy-restricted to a small allowlist** (confirmed: direct calls to Celenium, Injective's LCD, Subscan, AIOZ's/Flux's explorers, even Solana's RPC, all rejected with "policy denial," including through `WebFetch` — not just raw `curl`) — the routine has to be the one to confirm these, since it runs with different, broader network access.
- **6 tokens with no chain of their own** (`the-graph`, `cartesi`, `chainlink`, `ondo-finance`, `livepeer`, `jupiter-exchange-solana`/JUP): ERC-20s on Ethereum, or (JUP) an SPL token on Solana. Deliberately **never given a chart** — "this token's on-chain activity" would just measure Ethereum's or Solana's overall usage, a real number that would nonetheless mislead if presented as if specific to the project. Renders an explanation instead, same honesty principle as Tokenomics' "Offre non plafonnée" (state the real reason data doesn't apply, never blank silence, never a misleading number).
- **`fetch-ai` (FET) deliberately left unclassified** (renders nothing either way): had its own chain (fetchhub) but its status likely changed with the ASI Alliance merger — genuinely unverified from here, so not guessed into either list. `docs/routines/favoris-quotidien.md` §2 asks the routine (real WebSearch access) to resolve this before anyone adds it to `ONCHAIN_OWN_CHAIN_ASSETS`/`ONCHAIN_NO_OWN_CHAIN_ASSETS`.

Two traps hit and fixed while building the original BTC version (2026-09-14), both worth generalizing:
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

**`docs/routines/*.md` (started 2026-09-14) — the workaround for "invisible to git log."** A routine's live prompt still can't be read back, but nothing stops writing (and keeping current) a versioned spec it's told to follow — `aguilaradar-favoris-quotidien`'s prompt is now a short pointer: "read `docs/routines/favoris-quotidien.md` and follow it exactly." Changing that routine's actual procedure going forward means editing the `.md` + committing, **not** another blind `update_trigger` overwrite. Extend this pattern to other routines rather than reintroducing an unversioned prompt. Caveat: the pointed-to file must exist on the branch the routine actually reads (`main` — confirmed via its `session_request.sources` in `get_session`), not just on a feature branch. **Writing the `.md` is Piste A-safe (just a file); actually pointing the live trigger at it requires `update_trigger`, which this project treats as a deliberate, confirmed-with-the-user action, not an automatic follow-on to writing the doc** — a routine's trigger config is a live, unattended, scheduled system, not local reversible work.

`docs/routines/marche-quotidien.md` (added 2026-09-15) extended this to the 3rd routine — versioning its *already-working* prompt (real, cross-source-reconciled ETF flow data, temporally-consistent BTC/gold ratio) so it can't silently drift, not fixing something broken. **Read its actual live prompt (`get_session`/`list_triggers`) before writing the doc — don't assume based on what worked in an interactive tool call.** Concretely: this session verified Alpha Vantage's Treasury-yield MCP tool works fine interactively, and was about to recommend it for `fed_policy.treasury_yield_10y_pct` — but the routine's real prompt already carries a permanent, hard-won rule forbidding `mcp__CoinGecko`/`mcp__Alpha`/`mcp__Anthropic_Economic_Index` tools entirely: they hang the session indefinitely in this routine's *automated, one-shot* execution mode (confirmed repeatedly), even though the identical tool call is fine in an interactive session like this one. **A tool verified working in one execution mode is not evidence it works in another** — `aguilaradar-opportunites-quotidien` is the one documented exception (a persistent session, different mode, CoinGecko connector genuinely safe there). This routine already avoids the trap (WebFetch direct + WebSearch fallback for everything); the new doc preserves that rule prominently rather than "helpfully" replacing it with the MCP tool.

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

**Same bug, second confirmed instance, same day:** `data/news.json`'s `last_checked_at` was independently found stuck at the identical timestamp (`2026-09-14T16:20:00Z`) by `aguilaradar-verif-fraicheur-quotidien` itself (its own health check, not this investigation) — same routine (`aguilaradar-cycle-2h`), same root cause (a bookkeeping field only touched when something substantive happens, not every cycle), same fix shape. The routine's actual news-monitoring work (fear&greed, BTC dominance, hack/exploit search) turned out to have never been in the versioned spec at all — a real gap, not just this one field — now added as `cycle-2h-verdict.md` §8, distinguishing `last_checked_at` (touch every cycle, proves the check happened) from `last_updated_at` (only touch when `items` actually changes — a stale `last_updated_at` next to a fresh `last_checked_at` is the normal, expected state when nothing new clears the bar). **Pattern worth watching for elsewhere**: any routine-written file with a "did I check" timestamp separate from a "did I find something new" timestamp is at risk of this same silent gap — the fix is always to name the "touch every cycle regardless of outcome" field explicitly in that routine's spec, not assume it's obvious.

**Unrelated, and confirmed benign while investigating this**: dozens of leftover `claude/compassionate-ritchie-*` branches exist on the repo (one per routine session's outcome branch) — sampled one (`w7lq7j`, the `0101615` commit already cited above) and confirmed it *is* an ancestor of `main`, i.e. already merged, just never deleted. Branch clutter, not evidence of missed merges — don't mistake the accumulation for a problem without checking `git merge-base --is-ancestor` first.

### Before proposing a new data source, check `data/market-context.json` — it's richer than it looks (found 2026-09-15)

Asked what data could improve the engine, proposed adding Treasury yields, BTC/ETH spot ETF flows, and stablecoin supply/dominance as *new* sources — without first reading `data/market-context.json`. All three already exist there (`fed_policy.treasury_yield_10y_pct`, `etf_flows` with real per-issuer breakdown and cross-source reconciliation, `stablecoins.dominance_pct`), written daily by `aguilaradar-marche-quotidien`, already rendered on-site (`insights.js:renderMarketContext`, Moteur → Contexte marché) and already fed to the AI assistant (`assistant.js`). A real research gap, not a hypothetical one — corrected once the user asked to proceed and the file turned up. **Check the 12 routines' existing `data/*.json` outputs before proposing a new one; a plausible-sounding gap is often already filled**, same discipline as the CoinGecko-ID-verification rule in `config.js` above (verify before asserting, don't reason from what "should" exist).

The *real* gap, once `market-context.json` was actually read: `docs/routines/cycle-2h-verdict.md` never said how to derive `regime_at_issue`/`signal_consensus.macro` at all, and the routine's own cycle logs showed it was inferring "macro" from the fear & greed index alone — ignoring the far more rigorous `market-context.json` sitting one file away (Fed stance, Treasury yield trend, ETF flow direction, stablecoin dominance). Fixed by extending `cycle-2h-verdict.md` §4 (the existing per-ticker cross-referencing section) rather than inventing a new numeric formula: read `market-context.json` once per cycle (macro context is shared across all 15 verdicts, not per-ticker), combine the signals qualitatively, and **explicitly render `neutre` and say so in `reasoning` when they genuinely conflict** (real current case: Fed hawkish + 10Y yield at a post-2023 high point toward `risk-off`, while BTC/ETH ETF flows are net positive and point `risk-on` — retained as an open contradiction, not arbitrarily resolved toward whichever verdict was already being leaned toward).

### Engine self-diagnosis: `confidence_pct` was fixed on 09-14, verdict *selection* never was (found 2026-09-21)

The 09-14 revision fixed `confidence_pct`'s concentration on 50/60% (values 47-77% seen since), but `accuracy_strict_pct` didn't move (still ~25% against a 57% majority-class baseline) because that revision never touched what actually picks `ACHAT`/`ATTENTE`/`VENTE` from `signal_consensus.technique` — that mapping was never written down anywhere in `cycle-2h-verdict.md`, only assumed. Independent recomputation from `data/verdicts.json` (56 resolved, cross-checked against `js/insights.js`'s live page numbers — they matched exactly, so this is not a display bug) found the unwritten default badly miscalibrated: `technique="baissier"` → ATTENTE 10/10 times, **never once** VENTE; `accord_count=1` (32/56, the single most common bucket) → ATTENTE 32/32 times, even though the doc only forces ATTENTE at `accord_count=0`. Net effect: 78.6% of resolved verdicts are ATTENTE — **both before and after** the 09-14 fix (44/56, then 12/15) — against only 17.9% of real outcomes actually landing flat. The engine hedges roughly 5x more than this market actually stayed flat, which is the real driver of the sub-baseline accuracy, not a calibration issue.

Fixed by adding an explicit rule to `cycle-2h-verdict.md` §2 (end): `technique` haussier/baissier + `accord_count≥1` must now produce a directional verdict, never ATTENTE by default; `accord_count=0` still forces ATTENTE as before. Logged as `corr-20260921-biais-attente-asymetrique` in `engine-history.json`, same schema as prior entries. **This is a spec change, not a code change — it only affects verdicts the routine issues after this file reaches `main`, and won't move `accuracy_strict_pct` for 7-14 days** (verdicts need to reach `horizon_days` before resolving); there is no way to improve a forward-testing accuracy number retroactively without editing historical verdicts, which this deliberately does not do. Judge this rule the same way as `corr-20260906`/`corr-20260913` before it: not before ~10 verdicts issued under it have resolved.

**False alarm, checked 2026-09-21 — don't re-flag this one**: `v-20260807-btc`/`v-20260807-eth` carry a `signal_precoce`-self-flagged `price_at_issue` anomaly (~16-17% off an independent cross-check made at issuance — see each verdict's own `signal_precoce.note`). First reported here as an unresolved residual, before being checked against a live source — that was a mistake: verifying via CoinGecko's real `/coins/{id}/history` for 2026-08-07 shows `price_at_issue` was correct all along (BTC 55,800 stored vs. €55,764 CoinGecko; ETH 1,649.89 vs. €1,650.60 — both <0.1% off, well inside normal intraday noise for a 20-minute gap between the UTC-midnight snapshot and issuance). The original 08-10 note's "anomaly" was its own bug: it compared `price_at_issue` in EUR against sources it cited in USD (~$64-65k, which is a good match for CoinGecko's *USD* price that day, $64,262.75) without converting. No data was ever wrong; the note claiming otherwise was. Lesson: this session repeated the exact mistake `config.js`'s CoinGecko-ID rule and the market-context.json finding above both already warn against — inheriting a prior claim (even one this project's own routine made, with its own citations) without re-checking it against a live source before writing it into permanent docs. Verify first, especially when about to declare something "probably wrong."

### Favoris rotation catch-up (found 2026-09-21) — same missed-cycle pattern as elsewhere, not a rotation-logic bug

Re-investigated the same "stale favoris" symptom as the 09-14 finding above (data-integrity.js flagged 6/15 again: BTC/ETH/ARB/INJ at 11 days, JUP/LPT at 21 days). This time the rotation logic itself is correct — verified against `data/favoris-context.json`'s actual `last_computed_at` values and `git log`, which shows rotation commits on 09-15 and 09-16 then **nothing until 09-21**, a 5-day gap matching the same missed-cycle window already on record for `verif-fraicheur-quotidien` elsewhere in this file. A scheduling/trigger-reliability gap, not something a spec file can fix. Added a bounded mitigation instead (`favoris-quotidien.md`, rotation section): once a cycle resumes, process up to 8 tickers (not just 3) while a 4th-oldest ticker is still >7 days stale, so a multi-day gap clears in 2-3 catch-up cycles instead of 5 — shortens recovery from a gap, doesn't prevent the next one.


### Réduction des routines du 03/10/2026 (quota hebdo épuisé)

Constat git : aucun commit de routine du 28/09 au 03/10, puis reprise par à-coups à chaque
recharge de quota. `list_triggers` : 15 routines actives, ~38 exécutions/jour, dont
`aguilaradar-watchdog-cycle-2h` (12/jour) toujours actif alors que CLAUDE.md le disait désactivé
depuis le 06/09. Le prompt digest faisait `cat` de verdicts/opportunities/alerts/engine-history/
news/market-context (~480 Ko, ~140k tokens par passage) ; horizons faisait `cat` de
opportunities.json (~125 Ko). Au redémarrage du 28/09, le cycle a émis 9 verdicts d'un coup
(pic qui revient tous les 14 jours, à l'échéance commune).

Actions : CLAUDE.md 41 → ~10 Ko (historique déplacé ici) ; specs routines en lecture ciblée ;
plafond de rattrapage (3 verdicts, 3 favoris) ; cycle 4h → 8h avec seuils de fraîcheur dérivés de
`REFRESH.deepCycleHours` ; digest 2×/jour, horizons 1×/jour, alertes e-mail 2×/jour, watchdog
désactivé ; prompts digest/horizons réécrits (seule l'étape de lecture/écriture change, ~10 Ko lus
au lieu de ~480 Ko). L'agent a pu changer les horaires digest/horizons ; le classifieur a refusé
la désactivation du watchdog, l'horaire du cycle et les réécritures de prompt, et
`alerte-crypto-quotidienne-cloud` (créée via `http_api`) n'est pas modifiable par un agent →
appliqués par l'utilisateur, relus via `get_trigger`/`list_triggers`. Le prompt horizons traite
aussi `archived_opportunities` (horizon j14 d'`opp-20260904-ada` en attente depuis le 18/09).

### 04/10/2026 — historique du portefeuille figé depuis le 14/09

`data/portfolio-history.json` était écrit « en passant » par le cycle-2h sans que la spec
(`docs/routines/cycle-2h-verdict.md`) ne le mentionne ; la réécriture économe du prompt l'a fait
disparaître et le graphique est resté à 13 points (31/08 → 14/09). Correctif : GitHub Action
`portfolio-snapshot` (quotidienne 20:40 UTC, `scripts/portfolio-snapshot.mjs`, CoinGecko
`/simple/price`), donc aucun coût de quota. Jour sauté si un seul prix/qty manque, jamais de
backfill. Côté affichage : abscisse par date (le trou reste visible), mention des apports nets
(la valeur totale mélangeait apports et performance), avertissement si le dernier point a ≥ 2 j.
Même date d'arrêt constatée pour `data/alerts.json` (dernière alerte 14/09) — non corrigé, cause
probable identique, à vérifier.

### 04/10/2026 (suite) — alertes rétablies, fraîcheur de l'historique surveillée

Cause confirmée via `list_triggers` : aucun prompt de routine actif n'écrit `alerts.json` (seuls
digest/briefing/santé le *lisent*) ; le cycle-2h le faisait avant son allègement. Effet en
cascade : plus de push (le Worker ne relaie que les nouvelles entrées), « rien de significatif »
dans le mail quotidien, digest sans alertes. Correctif : `scripts/price-alerts.mjs` + workflow
`price-alerts` (02:40/10:40/14:40/22:40 UTC, hors créneaux des routines) : verdict `pending` non
échu dont le prix CoinGecko EUR s'écarte de `price_at_issue` d'au moins `threshold_pct` → une
alerte (champ `verdict_id` = anti-doublon), max 3 par passage (anti-rafale de push). Les types
`actualite_*`/`avis_du_jour` (jugement éditorial) ne sont PAS rétablis — ils demanderaient une
modification du prompt cycle-2h (coût quota), à décider par l'utilisateur.
Risque latent noté, non corrigé : le Worker garde 500 ids notifiés (`MAX_TRACKED_IDS`) ; quand
alerts+opportunités dépasseront ~500 entrées, les plus anciennes seront re-notifiées en boucle.
`FRESHNESS_SOURCES` inclut désormais `portfolioHistory` (30 h / 54 h).
**Devise de `price_at_issue` non homogène** (constaté le même jour en recoupant la 1re exécution) :
aucun champ ne la porte ; verdicts des 20 et 28/09 en $, CTSI (22/09, 03/10) et août en €. Les
3 premières alertes (FET/GRT/ONDO) comparaient € et $ → retirées puis réémises sous les mêmes ids.
`issueCurrency()` lit la devise dans `reasoning` (nombre = `price_at_issue` + symbole) ; introuvable
= pas d'alerte. **Non vérifié et probablement plus grave** : la résolution des verdicts par le
cycle-2h (`docs/routines/cycle-2h-verdict.md` §5) compare-t-elle dans la même devise ? Sinon biais
de ~11 % (EUR/USD) sur les issues et donc sur l'exactitude du moteur. La spec devrait imposer un
champ `currency` à l'émission.

### 04/10/2026 (fin) — devise des verdicts : diagnostic vérifié sur l'historique réel

Correction de l'entrée précédente : le texte de `reasoning` **ment** sur la devise (ex. INJ 5,09
écrit « € » dans une alerte du 14/09 et « $ » dans le verdict du 20/09). Vérifié via CoinGecko
`/coins/{id}/history` (relevé 00:00 UTC ≈ émissions de 23h2x) : verdicts émis **jusqu'au 13/09 en
EUR** (LINK 11,32 = 11,40 € ; ARB 0,1635 = 0,1630 €), **à partir du 20/09 en USD** (BTC 81 218 =
81 169 $ ; FET, GRT, LINK, ARB, INJ, PEAQ idem à <0,5 %), **CTSI toujours en EUR**. Conséquence :
les 14 verdicts émis les 06 et 13/09 (EUR) ont été **résolus le 20/09 avec un prix USD** (+~16 %
fictifs ; ex. ARB +91,6 % enregistré pour +66,9 % réel). Recalcul au taux EUR/USD du 21/09
(0,87116) : seules 2 issues changent (BTC faux→juste, FET juste→faux), exactitude inchangée
(18/67) ; le diagnostic corr-20260921 (biais ATTENTE) tient. **Correction des données NON
appliquée** (bloquée par le garde-fou, réécriture d'historique : décision utilisateur) — script
prêt dans le résumé de session. Appliqué : spec cycle-2h (USD + champ `currency` obligatoire,
résolution dans la devise du verdict, table pour les verdicts sans champ), `verdictCurrency`
(`insights.js`, la tendance provisoire affichait ~−13 % fictifs sur les verdicts en $), même règle
dans `scripts/price-alerts.mjs` (remplace la lecture du texte).
→ Correction des 14 résolutions **appliquée le 04/10 22h30 UTC** avec l'accord de l'utilisateur
(`corr-20261004-devise-resolution`, valeurs d'origine dans `outcome.currency_correction`, champ
`currency` ajouté aux 14 + à tous les pending). Exactitude inchangée 26,87 % ; baseline classe
majoritaire 59,7 → 56,7 % ; F1 macro 24,42 → 23,77.

### 05/10/2026 — ce que l'allègement du cycle-2h (14-15/09) avait cassé en silence, et correctifs

Audit des horodatages internes de tous les `data/*.json` : figés au 13-14/09 = `alerts.json`,
`portfolio-history.json` (corrigés le 04/10), `engine-history.macro_regime` (bandeau Accueil,
Assistant, mail quotidien affichaient « risk-on, F&G 58, dominance 58,6 % » du 14/09 comme
actuels), `paper_portfolio_stats` et `global_stats.baseline_buy_hold_btc_pct` (onglet Moteur).
Correctifs : (1) `scripts/market-gauges.mjs` dans le workflow `price-alerts` → `data/market-gauges.json`
(peur/cupidité alternative.me, dominance BTC CoinGecko /global ; mesures brutes, aucun jugement) ;
(2) `macroView()` (`app.js`) : jauges fraîches + régime **daté**, affiché « pas réévalué depuis »
au-delà de 3 j ; (3) spec cycle §7 : le cycle recopie le régime qu'il calcule déjà pour ses verdicts ;
(4) portefeuille fictif et buy&hold calculés en direct (`computePaperPortfolio`), formule de la
routine retrouvée et **vérifiée sur ses deux valeurs publiées** (−3,24 % au 06/09 sur 31 verdicts,
−5,10 % au 13/09 sur 41). Aussi : numéros `?v=` d'`index.html` mis à jour (oubliés le 04/10).
Non corrigés (blocs morts, aucun lecteur visible) : `opportunities_stats` (12/08),
`data_source_reliability` (14/09, lu seulement par la spec marche-quotidien).
Suite (même jour) : **Avis du jour** (Accueil) figé au 14/09 → mention explicite « pas renouvelé
depuis N jours » au-delà de 3 j ; **push du digest en échec** depuis le 23/09 (clé VAPID et
abonnement codés en dur dans le prompt digest, ≠ `js/notify.js`) → nouveau prompt digest (à coller
par l'utilisateur, l'API refuse la modification depuis une autre session) : plus de web-push ni de
clé privée dans le prompt, le digest ajoute 1 entrée `avis_du_jour`/jour à `alerts.json` et le
Worker (bonnes clés) la notifie. **verif-fraicheur** jugeait les news sur `last_updated_at` (fausse
alerte quasi quotidienne) et faisait `cat` d'engine-history → nouveau prompt (extraction python,
`last_checked_at`, + historique portefeuille et jauges). **briefing-email** lisait F&G/dominance
figés → nouveau prompt (`market-gauges.json`, régime daté). **Constat du 06/10 : aucun de ces 3
prompts n'a été collé** (`list_triggers` : digest modifié la dernière fois le 03/10, toujours
web-push/VAPID ; briefing-email le 31/08 ; verif-fraicheur encore en version 17/08 jusqu'au
correctif partiel collé le 06/10 au soir). Même jour, `get_session` sur les 3 routines en session
persistante : contexte 443 k tokens (verif-fraicheur), 491 k (opportunités), 274 k (briefing-email),
coût cumulé ~99 $, ~88 $ et ~95 $ d'équivalent API depuis mi-août — contre 0,17 $ pour une
exécution d'horizons en session fraîche. **Worker** : `slice(-500)` des ids
notifiés aurait re-notifié en boucle au-delà de 500 entrées → ids encore présents jamais oubliés
(code corrigé ici, **pas encore déployé** sur `aguilaradar-assistant-ia` : connecteur Cloudflare non
autorisé pour vérifier le déploiement).

### 06/10/2026 — corr-20260921 (biais ATTENTE) : encore trop tôt pour juger, conformité intacte

Rappel programmé 14 jours après la fusion de la règle de sélection ACHAT/ATTENTE/VENTE (PR #7) et
du vérificateur `checkVerdictSelectionCompliance` (PR #8, `js/data-integrity.js`). 19 verdicts émis
après le cutoff formel (21/09 23h26 UTC), 10 résolus. **Conformité : 0 violation** — chaque fois que
`signal_consensus.technique` a été lu haussier/baissier avec `accord_count≥1` depuis, le verdict a
bien été directionnel, sans exception, y compris sur les 7 verdicts haussier→ACHAT émis d'affilée le
05/10 (encore pending, échéance 12-19/10).

Mais le mécanisme n'a été réellement **exercé** qu'une seule fois dans la fenêtre stricte post-fusion
(`v-20260928-link`, incorrect : ACHAT émis, +1,86 % réel, resté sous le seuil directionnel). Un
deuxième cas pré-existe juste avant la fusion (`v-20260920-link`, correct, +11,76 %) mais ne teste
pas la règle elle-même (émis ~23h avant qu'elle soit en vigueur) — à distinguer, la note du 28/09
dans `correction_log` l'avait compté un peu vite comme un test. Aucun cas baissier→VENTE ne s'est
présenté du tout depuis le 20/09 : la moitié de la règle n'a encore jamais été mise à l'épreuve.

Les 9 autres résolutions du lot (mixte/neutre → ATTENTE, non concernées par cette règle précise)
donnent 3/10 corrects au global du lot (30 %, sous la baseline 50 % du même lot) — un chiffre qui ne
dit rien sur l'efficacité de la règle testée ici, seulement que « mixte/neutre → ATTENTE » a mal
performé sur ce lot particulier (3/9). Noté comme angle à surveiller, pas corrigé maintenant : une
seule variable à la fois, cf. la discipline déjà établie par `corr-20260906`/`corr-20260913`.

`validation_score_after_pct` de `corr-20260921-biais-attente-asymetrique` laissé à `null` (3e fois
de suite, même discipline que les notes du 28/09 et du 05/10) — le seuil du document (~10 cas où le
mécanisme se déclenche réellement) est loin d'être atteint avec n=1. Prochain rappel : 20/10/2026,
après résolution du lot du 05/10 (le premier échantillon vraiment informatif, 7 cas haussier→ACHAT
d'un coup).

### 09/10/2026 — "Ce qui bouge" affichait un hack du 24/09 en premier : bug d'affichage, pas de donnée figée

Signalé par l'utilisateur (capture d'écran) : le hack Bitget du 24/09 restait affiché en tête de
"Ce qui bouge" (Accueil) 2 semaines plus tard, l'air d'une actualité qui ne se met plus à jour.
Vérifié sur `data/news.json` réel (`origin/main`) avant toute conclusion : `last_checked_at` était
à l'heure du cycle du jour même (la veille tourne normalement, aucun cycle manqué) et
`last_updated_at` au 05/10 (4 jours, pas 2 semaines) — le contenu n'était donc pas figé, seul
l'Ethereum Glamsterdam ajouté le 05/10 était le dernier élément du tableau `items`.

Cause réelle : `renderNews()` (`js/app.js`) affichait `items` dans l'ordre brut du fichier — un
tableau en ajout, le plus récent en DERNIER (même convention que `correction_log`/`alerts.json`,
déjà gérée correctement ailleurs par `.slice().reverse()` dans `renderNotifications` et
`renderEngineTab`, mais oubliée ici). L'item du 24/09, ajouté en premier, restait donc toujours en
tête. Corrigé : même `.slice().reverse()`, plus un indicateur de fraîcheur (`last_updated_at`
≥3 jours → "ajoutée il y a N jours", même seuil et même ton que `renderAvisDuJour`) pour que la
liste dise elle-même quand elle n'a pas été renouvelée récemment, plutôt que de laisser deviner.

Au passage, trouvé que `data-integrity.js?v=` dans `index.html` n'avait jamais été bumpé depuis le
14/09 malgré l'ajout de `checkVerdictSelectionCompliance` le 21/09 (PR #8) — un navigateur ayant mis
ce fichier en cache avant le 21/09 pouvait donc servir une version sans le vérificateur de
conformité. Bumpé avec `app.js` dans le même commit.

### 09/10/2026 (suite) — revue générale demandée par l'utilisateur : 1 vrai bug de plus trouvé et corrigé

Demande explicite de repasser sur tout ce qui restait pour une version finalisée. Démarche :
chercher la même CLASSE de bug ailleurs plutôt qu'un audit non ciblé (coûteux en tokens, voir
règles d'économie en tête de `CLAUDE.md`).

- **`renderOpportunities`/`renderOpportunityTiles`** (affiche `opportunities.json`, lui aussi en
  ajout — vérifié `flagged_at` croissant du premier au dernier élément) : pas le même bug que
  `news.json` — trié par `computeConfidence()` décroissant (`cards.js`), un choix voulu (meilleures
  pépites d'abord, pas les plus récentes). Vérifié avant de conclure, rien à corriger.
- **`scripts/price-alerts.mjs` ligne 78** : `source: "...${cur.toUpperCase()})"` entre guillemets
  droits, pas des backticks — `${...}` ne s'interpole jamais hors template literal, donc ce texte
  s'affichait tel quel, littéralement, sur l'onglet Alertes (`<p class="hint">Source : ...`,
  `app.js`). **Confirmé sur les vraies données** : 21 des 97 alertes `seuil_technique` de
  `data/alerts.json` portaient ce texte cassé. Corrigé : backticks dans le script (prouvé non
  isolé par `grep -rnE '^\s*[a-zA-Z_]+:\s*"[^"]*\$\{'` sur `js/`+`scripts/`+`cloudflare-worker/`,
  aucune autre occurrence), test de régression ajouté (`source` ne doit jamais contenir `${`), et
  les 21 entrées déjà écrites corrigées en place (devise réelle retrouvée via `issueCurrency()` sur
  le verdict lié, jamais devinée) — seul le texte de citation changeait, jamais `message` (déjà
  correct, interpolé via backticks) ni aucune valeur de prix/mouvement.
- **`engine-history.json.opportunities_stats`** : figé au 12/08/2026 (`total_flagged: 8`, contre 7
  opportunités réelles aujourd'hui), aucun lecteur nulle part (`grep` sur `js/`/`test/`/`docs/`) —
  bloc mort, supprimé. `data_source_reliability`, en apparence similaire, a un vrai lecteur
  (`docs/routines/marche-quotidien.md`) — laissé tel quel.
- Vérifié que le correctif anti-boucle du Worker (`MAX_TRACKED_IDS`, ids encore présents jamais
  évincés) est bien présent dans `cloudflare-worker/worker.js` ici — toujours pas déployé sur
  `aguilaradar-assistant-ia` (accès Cloudflare non autorisé dans cette session, et ce 2e dépôt n'est
  de toute façon pas dans le périmètre accordé à cette session).

npm test : 677/677 après ce passage.

### 10/10/2026 — tableau de bord unique, stats moteur de l'Assistant, or sans quota, relais IA

Demande utilisateur : un « responsable » qui coordonne les agents pour éviter l'éparpillement.
Constat : aucun agent ne se souvient des autres, la seule mémoire partagée est ce dépôt. Créé
`docs/feuille-de-route.md` (état vérifié, problèmes ouverts avec preuve et responsable, journal
des sessions), pointé depuis `CLAUDE.md` pour les sessions interactives (pas les routines).
Notion écarté comme mémoire : les routines n'y ont pas accès (outils MCP bloquants en routine).

- **Assistant / stats du moteur** : `answerEngine` et `buildAiContext` lisaient
  `engine-history.global_stats`, recalculé seulement par certains cycles et figé au 05/10
  (90 émis, 81 vérifiés, 25,93 %) alors que l'onglet Moteur calcule en direct (97, 82, 25,61 %).
  `chatEngineStats` réutilise `computeEngineStats` (engine.js), repli sur `global_stats`.
- **Or** : `market-context.gold` à null depuis ≥08/10 (la routine ne trouve pas de cours daté).
  `scripts/market-gauges.mjs` relève PAX Gold + Tether Gold (`pax-gold`, `tether-gold`, vérifiés
  via CoinGecko /search ; 4183,38 $ et 4181,51 $ le 10/10, cohérent avec les ~4130-4160 $ cités
  par la routine les 6-8/10). Moyenne publiée seulement si écart ≤ 2 %. Site (`goldSpotView`,
  insights.js) et Assistant : valeur de la routine prioritaire, relevé du robot en repli,
  toujours présenté comme approximation datée. Taux 10 ans : FRED et home.treasury.gov
  injoignables depuis la session (proxy et WebFetch), donc non branché — format non vérifiable.
- **Relais IA** : la seule différence entre `cloudflare-worker/worker.js` et
  `aguilaradar-assistant-ia/worker.js` était le correctif `MAX_TRACKED_IDS` du 05/10. Test ajouté
  (`test/worker-push.test.js`) : échoue sur la version de l'autre dépôt, passe ici. Poussé
  (`d0115fa`) ; mise en ligne Cloudflare non vérifiée (connecteur non autorisé).
- Piège rencontré : la copie locale de la session était superficielle (historique depuis le 24/09),
  `git merge-base` concluait à tort à un historique réécrit. `git fetch --unshallow` avant toute
  conclusion sur l'ascendance des branches.

### 10/10/2026 (soir) — connecteur CoinMarketCap : pilote préparé, règle MCP corrigée

Demande utilisateur : brancher CoinMarketCap sur toutes les routines. Non fait d'un coup : un outil
de connecteur peut bloquer une routine automatique (incidents CoinGecko d'août). **Constat qui
corrige la règle** : `favoris-quotidien` (session fraîche) a bien utilisé l'outil Blockscout en
automatique le 10/10 08h27 (`onchain-history.json` : `tx_per_day` sourcé « Blockscout MCP,
direct_api_call chain_id=1 … 2026-10-09 ») — l'interdiction n'est donc pas universelle, elle dépend
du connecteur/de l'autorisation. Seul un essai en automatique tranche pour CoinMarketCap.

- Testé en session interactive : `get_global_metrics_latest` (~5,5 Ko, valeurs en texte « 378.07 B »,
  saison des altcoins 64, positions ouvertes 378,07 Md$, financement +0,0042 %, encours ETF BTC
  108,82 Md$ — un encours, pas un flux) ; `find_skill` gratuit, mais `execute_skill` facturé (taux
  10 ans et flux ETF nets seulement par cette voie).
- Pilote : `marche-quotidien`, appel en dernière étape après le commit habituel, conversion par
  `scripts/write-crypto-global.py` (testé : valeurs réelles, valeur illisible → null, rien écrit si
  tout est vide). Site (`renderCryptoGlobalRow`) et Assistant prêts. Activation = 2 gestes de
  l'utilisateur (`docs/coinmarketcap.md`) ; aucune modification de routine possible depuis cette
  session (outil routines absent).
- Au passage : carte « Flux ETF BTC » formatée par `formatMarketCap` (« Md€ », signe perdu) alors
  que la valeur est en USD → `formatUsdAmount`.
- Cloudflare autorisé par l'utilisateur, mais outils non chargés dans une session démarrée avant :
  vérification du déploiement du Worker reportée à la prochaine session.
- Même soir, sur proposition de l'utilisateur : **routine dédiée** `coinmarketcap-quotidien` au lieu
  d'une étape ajoutée à `marche-quotidien`, et **fichier dédié** `data/crypto-global.json` au lieu
  d'un bloc dans `market-context.json` (un fichier = une routine propriétaire : un blocage
  CoinMarketCap ne touche aucune autre routine, et `marche-quotidien` ne peut pas l'écraser).
  +1 exécution/jour (~15, le plafond) ; compensation possible : fusion santé + fraîcheur.

### 10/10/2026 (fin de soirée) — textes plus courts, l'essentiel en avant

Demande utilisateur : résumer les textes du site en quelques phrases. Mesuré sur `origin/main` :
raisonnement des verdicts ~1 200 caractères (max 2 100), « titres » d'actualités ~500, notes du
contexte marché jusqu'à 1 140, thèses des favoris ~1 600. Le début des textes n'est souvent pas
l'essentiel (verdict : « le précédent a été résolu… » ; régime : « market-context.json rafraîchi…
lu en lecture seule ici »), donc une simple troncature montrait la mauvaise partie.
- Verdicts : `renderVerdictSummary` (config.js) affiche `signal_consensus` (3 pastilles) et les
  3 premiers `signals_used` de ≤ 70 caractères — exact par construction, aucune reformulation ;
  raisonnement complet masqué derrière « Lire l'analyse complète ». `accord_count` volontairement
  non affiché (sémantique ambiguë dans la spec cycle). Repli : aperçu 3 lignes si champs absents.
- Actualités : 2 lignes + « Lire plus » (bouton hors du lien) ; notes du contexte marché :
  `contextNote` (insights.js), aperçu + « Lire plus ».
- Helpers d'aperçu (`renderClampableText`, `wireClampToggles`, `makeKeyboardClickable`) déplacés
  de app.js vers config.js pour être utilisables par insights.js (chargé avant app.js, et testé
  sans app.js).
- Contraste : pastille baissière en `#f87171` (`--loss` sur fond teinté = 4,11-4,52 < 4,5) ; le
  badge VENTE existant avait le même défaut : corrigé de la même façon.
- Vrai résumé des textes libres (actualités, notes, thèses) : seulement possible si les routines
  écrivent un champ `resume` (P11, à décider).
- Suite (accord de l'utilisateur) : champ `resume` (1 phrase ≤ 160 caractères, seulement des faits
  déjà présents dans le texte complet) demandé à `cycle-2h` (verdicts, actualités, régime),
  `marche-quotidien` (chaque bloc) et `favoris-quotidien` (`long_term_thesis`). Textes à coller en
  fin de chaque spec. Site : `renderSummaryFirst`/`resumeHtml` (config.js) — résumé en tête, texte
  complet replié ; sans `resume`, comportement inchangé. Coût : quelques phrases par cycle.

### 10/10/2026 (nuit) — CoinMarketCap au service des analyses

Priorité exprimée par l'utilisateur : de meilleures analyses grâce au connecteur. Testé en session :
`get_crypto_quotes_latest` (15 favoris en 1 appel, ~9 Ko, évolutions 1 h → 1 an) et
`get_crypto_technical_analysis` (~0,7 Ko par actif : RSI 7/14/21, MM 7/30/200, MACD, Fibonacci,
pivot). Constat : `cycle-2h` décide de `signal_consensus.technique` sur les seules évolutions
24 h/7 j/30 j (`signals_used` de v-20261010-ctsi) ; CTSI émis ACHAT avec RSI14 71 et cours +30 % au-
dessus de sa MM200, sans le savoir.
- Ids CMC des 15 favoris vérifiés via `search_cryptos` (FLUX = 3029 « zel », pas FLX 15535), rangés
  dans `scripts/cmc-snapshot.py` (`--ids`).
- La routine enregistre les réponses brutes ; le script extrait et contrôle (RSI hors 0-100 → null ;
  MM7 hors ±50 % du cours → analyse technique écartée, contre une réponse sous le mauvais id).
  Testé sur des extraits réels (`test/fixtures/cmc-20261010`).
- Site : `renderCmcTechnicalSection` (detail.js), visible même si le calcul en direct échoue ;
  Assistant : `cmcTechnicalLines`.
- `cycle-2h` : enregistre `cmc_technical_at_issue` et cite les signaux contradictoires, **sans changer
  la règle de décision** (corr-20260921 en évaluation jusqu'au 20/10 : une variable à la fois). Les
  données accumulées permettront de mesurer si le surachat à l'émission prédit l'échec.
- `scripts/write-crypto-global.py` (1re version, 7 valeurs recopiées) gardé pour compatibilité si
  l'ancien texte a été collé ; à supprimer une fois la nouvelle routine confirmée.

