# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

aguilaradar is a static crypto radar: continuous market analysis, timestamped verdicts, a self-correcting backtest engine, a user portfolio tab (`data/portfolio.json`, live value/P&L from the engine's own verdicts, since 2026-08-25), a weekly fundamental thesis per position (`data/portfolio-thesis.json`, real web research by a routine — never the engine or chat AI — since 2026-08-26), and a transparent allocation ranking (since 2026-09-07: `js/allocation.js` — verdict + weekly thesis only, explicit "donnée non disponible" for anything else — surfaced as a Portfolio-tab card and as AI-relay grounding).

Built deliberately separate from Horizon (a local, hand-deployed personal dashboard, not a repo) since aguilaradar held no € amounts — reversed only for the Portfolio tab (Horizon's price precision was unsatisfactory): qty/invested is manually declared by the user, never inferred or wallet-connected. The repo is public, so these figures are exposed like every other `data/*.json` file — deliberate, not an oversight.

Three-part architecture, chosen to never depend on a credit system running out:
- **Hosting**: GitHub Pages — static files, no build step, no server.
- **Automation**: Cowork routines write `data/*.json` + commit. The frontend only renders; it never computes verdicts/opportunities itself.
- **Database**: this git repo — data is appended, never overwritten/reset, so full history survives inactivity.

Two speed tiers: **instant** client-side (prices/charts — live CoinGecko + Binance + TradingView on every open) vs **scheduled deep-cycle** (verdicts, Top 300 screening, backtest — quant pulse every 5-15 min, deep cycle every 4h, halved from 2h on 2026-09-06 to cut token cost). `aguilaradar-watchdog-cycle-2h` (its auto-recovery net) was disabled in the same change — its stale-detection threshold is hardcoded to the old 2h and can't be edited outside its own bound session, so a stuck cycle now only surfaces via the site's freshness indicator, not an automatic retry.

## Commands

```
npm install && npm test   # run the full suite once (Vitest + jsdom)
npm run test:watch        # watch mode
npx vitest run test/engine.test.js              # single test file
npx vitest run test/engine.test.js -t "name"    # single test by name
```

No build or lint step — devDependencies exist only to run tests; the deployed site is the raw `js/`, `css/`, `data/`, `index.html` served as-is by GitHub Pages. CI (`.github/workflows/tests.yml`) runs `npm ci && npm test` on every push to `main` and on PRs.

## Architecture

### No modules — shared global scope like a real browser page

`js/*.js` are plain `<script>` tags sharing one global scope (not ES modules) — a top-level `const`/`let` in one file is readable by files loaded after it in `index.html`'s order (e.g. `engine.js` uses `escapeHtml` from `config.js`). Get the load order wrong and the dependent file breaks at load time.

Tests reproduce this via real `<script>` tag injection (`test/helpers/loadPage.js`), not `eval` — `eval` gives each call its own top-level scope and breaks `const`/`let` sharing (verified empirically). `loadScripts(dom, [...])` must list files in the same order as `index.html`. Use `setGlobal`/`getGlobal` to poke/read top-level `const`/`let` from a test — plain `dom.window.name = value` doesn't work for those.

Out of scope for tests, deliberately: `background-fx.js` (decorative) and real network calls.

### `js/config.js` is the single source of config truth

`FAVORIS` (15 tracked assets), `SECTORS`/`SECTOR_COLORS`, `REFRESH`, `THRESHOLDS`, `DATA_URLS`, `escapeHtml`/`safeUrl`. Never hardcode a config value elsewhere.

- **CoinGecko IDs are verified via `/api/v3/search`, never guessed.** A wrong-but-plausible ID silently pulls the wrong asset. Trap already hit here: CoinGecko id `flux` is a *different* token (Datamine FLUX) — this project's Flux/Zelcash is `zelcash`. Horizon (the other repo) may still have this wrong.
- **`THRESHOLDS.directionalMovePct` is the ONE directional-move threshold, used everywhere** (backtest, confusion matrix, neutral-verdict evaluation). A prototype this project learned from used different thresholds per view (±3% vs ±10%) and made the numbers incomparable — never repeat that.

### Trust boundary: escape/sanitize anything that isn't our own computed data

News, AI-generated text, and the public CoinGecko API are untrusted for rendering: escape via `escapeHtml()` before `innerHTML`; sanitize any URL from that kind of source via `safeUrl()` (blocks `javascript:`/`data:`, allows only `http(s):`) before using it as `href`.

### Long analysis text is highlighted, not just escaped (`highlightKeyInfo`, `config.js`)

Verdict reasoning, the portfolio thesis, the correction log, the digest, and other multi-sentence analysis paragraphs go through `highlightKeyInfo()` instead of bare `escapeHtml()` — it escapes first (so swapping the two is always safe), then wraps key figures (%, $, €, decimal-comma numbers like "1,1 %") in a `.hl-stat` mark and `Bull:`/`Base:`/`Bear:` labels in color-coded `.hl-scenario` spans, so dense paragraphs can be scanned instead of read start to end (mobile complaint, 2026-08-31, re: `detail.js`'s `renderFavorisContextSection` — NOT `portfolio-thesis.json`, despite the similar heading). Wired into nearly every tab; deliberately left out of browser push-notification bodies (`notify.js`) — the Notification API doesn't render HTML.

Two things that would silently break it if "simplified" back:
- **`<span>`, never `<strong>`, for the scenario label.** Several blocks (`.detail-opinion strong`, `.disclaimer-box strong`...) already style *every* `<strong>` in their container as a block-level label. A `<strong>` here would break onto its own line mid-sentence.
- **The number pattern groups thousands by a lone space and decimals by comma/period separately** (`\d{1,3}(?:\s\d{3})*(?:[.,]\d+)?`) — a simpler `[\d\s.,]+`-style pattern silently splits a French decimal like "1,1 %" into "1," + "1 %". Regression test in `config.test.js`.

In the Assistant (`appendChatMessage`), the highlight only applies to `role === "assistant"` — the user's own message stays on `textContent`, never parsed as HTML (not an XSS risk either way, but the user's words aren't analysis text to decorate). Regression test in `assistant.test.js`.

### The access portal is a filter, not real security

`js/auth.js` + `ACCESS_HASH` gate the UI behind a SHA-256-hashed code. The repo is **public** (needed for free GitHub Pages hosting and for routines to commit directly), so the hash is visible in source and every `data/*.json` file is fetchable directly via the raw GitHub URL regardless of the portal. Filters a visitor who stumbles on the link, not a determined one — never treat it as an access-control boundary.

### AI relay for the Assistant (`cloudflare-worker/`) — AI-first, not a last resort

The Assistant prioritizes **factual sourced data first** (a tracked asset's real verdict, a glossary definition, a live CoinGecko lookup for an untracked asset), then sends everything else to the AI relay (`fetchLiveAiFallback()`) **before** trying a keyword match — a deliberate reversal from "rule-based first, AI as last resort": keyword-matching (`CHAT_INTENTS`) is now only a fallback for when the relay is unavailable or fails, never the default path (a keyword answering *instead of* reading the question was the exact bug users reported: "il répond automatiquement sans rien analyser").

Calls a small Cloudflare Worker using Workers AI (free tier, no API key, no recurring cost within limits), grounded only in real site data, never invented. `AI_RELAY_URL` (`config.js`) defaults to an unconfigured placeholder — in which case the site never calls out and falls straight to the keyword fallback, exactly as before the Worker existed.

**Critical deploy gotcha, learned the hard way:** the Worker's source lives in `cloudflare-worker/` in *this* repo, but Cloudflare Workers Builds actually watches a **separate, dedicated repo**, `jaki2402-dev/aguilaradar-assistant-ia`. Editing `worker.js` here and pushing to `main` changes nothing live until that separate repo is *also* updated (clone it, copy `worker.js`/`wrangler.jsonc`/`package.json`/`README.md`, commit, push). Auto-deploy reliability is **inconsistent, not simply broken** — confirmed both ways (sat unsynced 5+ days once; auto-deployed with zero dashboard action another time; auto-deployed within minutes on 2026-09-07). After pushing to the deploy repo: **verify with `workers_get_worker_code`** (Cloudflare MCP tool) rather than assuming either outcome, and only walk through the manual "Modifier le code → coller → Déployer" dashboard flow if that check shows the push didn't land.

### Assistant response modes (`detectResponseMode`, `js/assistant.js`, since 2026-09-07)

The AI relay picks one of 4 system-prompt formats — quick/allocation/comparison/thesis (`CORE_RULES` + `FORMAT_*`, `cloudflare-worker/worker.js`) — via a `responseMode` hint computed client-side (keyword/mention detection). This is only a hint, never the sole source of truth: the Worker's prompt describes all 4 branches so the model can self-select from the actual question text even if the hint is absent or wrong. `max_tokens` scales with mode (250 quick, 900 the other 3 — a comparison table or a 6-section thesis needs real room).

A question naming 2+ favoris (comparison) is routed **before** the single-asset short-circuit in `answerQuestion` — `findAssetMention()` only ever returns the *first* match, so without this a real comparison question ("INJ ou LINK ?") got the factual sheet of just one of the two. Comparisons and single-favori opinions also get that asset's long-term fundamentals (`favoris-context.json`'s `long_term_thesis`/`competitor`) injected into the AI context — targeted to the 1-3 assets actually named, never all 15 at once (would blow the relay's 20000-char context budget for no benefit on unrelated questions).

### Portfolio transaction writes (`POST /transaction`) — the Worker's second role, added 2026-09-02

The Portfolio tab's buy/sell form (`saveTransaction()`, `js/portfolio.js`) can write a real `qty`/`invested` update straight to `data/portfolio.json` via the GitHub Contents API, gated by a client-supplied `X-Portfolio-Secret` header checked against the `PORTFOLIO_WRITE_SECRET` Cloudflare secret. Same security class as `ACCESS_HASH` above — a casual-visitor filter, not real security — acceptable only because `portfolio.json` is a manually-declared simulation never wired to a real wallet/exchange, and every write is a reversible git commit. Needs `GITHUB_WRITE_TOKEN` (fine-grained PAT, scoped **only** to this repo, Contents R/W, never the deploy repo), `PORTFOLIO_WRITE_SECRET` (the user's own value, `sessionStorage` only, never committed), and `PORTFOLIO_WRITE_URL` (`config.js`) — until all three are set, `portfolioWriteConfigured()` gates the "Enregistrer" button off. Rate-limited to 20/hour via the reused `PUSH_STATE` KV namespace.

**Any new custom request header on this route needs an explicit entry in `corsHeaders()`'s `Access-Control-Allow-Headers`, or the failure looks like a dead network, not an HTTP error.** A header missing from the allow-list makes the browser's CORS preflight block the real request before it's ever sent — nothing reaches the Worker, nothing logs, the frontend only sees `TypeError: Failed to fetch`, indistinguishable from a genuine outage. This repo shipped exactly that bug once (2026-09-02): a Node script smoke-testing `handleTransactionRequest` directly went all green, because a direct function call never exercises real browser CORS enforcement and structurally cannot catch this bug class. Confirming a change here is safe only with an actual browser round-trip (or a human retest after deploy), never just a green smoke test.

### Data files (`data/*.json`)

Written by scheduled routines, not the frontend. Two are **append-only**, never overwritten/reset:
- `verdicts.json` — one entry per verdict ever issued; `status` moves `"pending"` → `"resolved"` only once `resolves_at` has passed. Show "pending", never invent an early outcome.
- `engine-history.json`'s `correction_log` — every engine self-adjustment attempt (what/why/before-after score/accepted-rejected), the engine's cross-run memory. `global_stats` (same file) is recomputed each cycle from resolved verdicts.

`opportunities.json`: Top-300 screening, CoinGecko "Meme" category excluded. `alerts.json`: threshold-driven (RSI, support/resistance, order-book imbalance) from the fast pulse, independent of the deep cycle. Since 2026-09-07, a `seuil_technique` alert on a favori gets a cross-referenced note (`contextualizeAlert`, `js/allocation.js`) only when the price move genuinely *diverges* from the weekly thesis — never a manufactured note when they agree.

`portfolio.json` is the **one exception** to "routines write, frontend reads": edited by hand (a human, or Claude on explicit request after new holdings are shared) — no routine ever writes qty/invested; `js/portfolio.js` only reads them to compute value/P&L live, never stores a number back. `qty`/`invested: null` + `pending: true` means the real numbers aren't in yet — render as pending, never guess.

`portfolio-thesis.json` (added 2026-08-26) is the **one file a Cowork routine writes directly**, by explicit user request — a real web-researched medium-term view per position, distinct from the engine's own ~14-day technical verdict (purely technical/backtested, never confuse the two). Shape: `{generated_at, positions: {<cgId>: {recommendation, conviction, constat}}}`, `recommendation` ∈ Renforcer/Conserver/Attendre/Réduire (case/accent-insensitive — `normalizeRecommendation()` maps it to a badge slug, falls back to plain text otherwise, never invents a badge). No entry, or no file, means no thesis yet — render nothing, never a stale/guessed one. `buildAiContext()` tells the AI relay explicitly when no thesis exists, so it doesn't extrapolate one from the technical verdict.

`favoris-context.json` — refreshed periodically, **keyed by ticker, not `cgId`** (the one file that isn't). Shape per asset: `competitor` (vs. a real-world analog), `long_term_thesis` (`bull`/`base`/`bear`/`assumptions_note`), `open_interest`, `defi_tvl`, `onchain_signal`. Rendered under "Thèse long terme" in `renderFavorisContextSection`'s "Contexte élargi" (shared by Portfolio/Favoris/Opportunités) — **not** `portfolio-thesis.json` above (Portfolio-only). **Real mistake already made here (2026-08-31):** a "hard to scan" complaint about "Thèse long terme" text got fixed against `portfolio-thesis.json`'s `constat` first (documented right above, sounds like the match) — but the text the user actually saw was this file's `Bull:`/`Base:`/`Bear:` split, and the fix had to be redone. Tell them apart by **shape**, not name: a single `constat` paragraph + a recommendation badge → `portfolio-thesis.json`; a `bull`/`base`/`bear` split with no badge, also visible on Favoris/Opportunités → `favoris-context.json`.

**Cowork routines gotcha, same shape as the Worker one above:** `briefing-crypto-hebdo-cloud` (weekly) and `alerte-crypto-quotidienne-cloud` (4h) email the user's portfolio and live entirely as Cowork trigger config — not files in this repo, so their prompt/cadence/email design never show up in a diff or `git log`. Confirmed 2026-09-07: also not readable through `list_triggers`/`update_trigger` — those tools only *write* a trigger's prompt (full replacement, no partial edit, no read-back); the only way to see current behavior is the actual email output (Gmail) or asking the user to paste the prompt from the Cowork UI. Both routines fetch `data/portfolio.json` read-only; `briefing-crypto-hebdo-cloud` additionally has real git write access, scoped **only** to writing `data/portfolio-thesis.json` weekly. A third routine, `aguilaradar-briefing-email-quotidien` (daily), reads `digest.json`/`alerts.json`/`engine-history.json` for a portfolio-free market email and stays read-only.
