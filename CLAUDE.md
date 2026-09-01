# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

aguilaradar is a static crypto market radar dashboard: continuous market analysis, timestamped verdicts, a backtest engine that self-evaluates and self-corrects, plus (since 2026-08-25) the user's own portfolio (`data/portfolio.json`) with live value/latent/P&L and per-position advice reusing the engine's own verdicts — and (since 2026-08-26) a real weekly fundamental thesis per position (`data/portfolio-thesis.json`, from actual web research by a routine, not the engine or the chat AI) shown alongside that technical verdict, and available to the Assistant.

It was originally built deliberately separate from Horizon (a personal portfolio dashboard — not a repo, a local `portefeuille-dashboard-v10.jsx` deployed by hand to Netlify) on the principle that aguilaradar holds no personal € amounts, only general market analysis. The user explicitly reversed that for the Portfolio tab specifically: Horizon's price precision was unsatisfactory and they wanted a single place with live latent gain/loss instead of maintaining two dashboards. This does **not** restore the separation for anything else — aguilaradar still doesn't run Horizon's macro-briefing logic or its Netlify deploy; only the qty/invested-per-position data model was adopted, manually declared by the user (never inferred, never connected to a real exchange/wallet). The repo being public, these figures are exposed exactly like every other `data/*.json` file (see "Portail d'accès" below) — accepted deliberately by the user, not an oversight.

Three-part architecture, chosen to never depend on a credit system that can run out:
- **Hosting**: GitHub Pages — plain static files, no build step, no server.
- **Automation**: scheduled Cowork routines (cloud) write to `data/*.json` and commit. The frontend never computes verdicts/opportunities itself — it only renders JSON that a routine already produced.
- **Database**: this git repo. Each cycle commits JSON files under `data/`; nothing is ever overwritten or reset, so full history survives even after days of inactivity.

The site has two speed tiers: **instant** client-side work (prices/charts — direct CoinGecko + Binance + TradingView widget calls on every page open) vs **scheduled deep-cycle** work (verdicts, Top 300 screening, engine backtest — requires actual reasoning, not instant-at-click; target cadence: quant pulse every 5-15 min, deep cycle every 2h).

## Commands

```
npm install && npm test   # run the full suite once (Vitest + jsdom)
npm run test:watch        # watch mode
npx vitest run test/engine.test.js              # single test file
npx vitest run test/engine.test.js -t "name"    # single test by name
```

There is no build or lint step — `npm`/devDependencies exist only to run tests; the deployed site is the raw `js/`, `css/`, `data/`, `index.html` files served as-is by GitHub Pages. CI (`.github/workflows/tests.yml`) runs `npm ci && npm test` on every push to `main` and on PRs.

## Architecture

### No modules — shared global scope like a real browser page

`js/*.js` files are **not** ES modules. `index.html` loads them via plain `<script>` tags in a specific order, and top-level `const`/`let` declared in one file is readable by files loaded after it, exactly like classic scripts in a browser (e.g. `engine.js` uses `escapeHtml` from `config.js`; `app.js` reads `latestFavorisPrices` set by `prices.js`). When adding a new file or a cross-file reference, the `<script>` order in `index.html` is what makes it work — get that order wrong and the dependent file breaks at load time.

Tests reproduce this exactly instead of mocking it away: `test/helpers/loadPage.js` builds a JSDOM page and injects the real `js/*.js` source as actual `<script>` tags (not `eval`, which — verified empirically, see the file's header comment — gives each call its own top-level scope and breaks `const`/`let` sharing across files). Each test gets a fresh `dom`/scope; the `loadScripts(dom, [...])` file list must be given in the same dependency order as `index.html`. Use `setGlobal`/`getGlobal` from that helper to poke or read top-level `const`/`let` from a test (plain `dom.window.name = value` does not work for those — same scoping reason).

Out of scope for tests, deliberately: `background-fx.js` (decorative only) and real network calls.

### `js/config.js` is the single source of config truth

`FAVORIS` (the 15 tracked assets), `SECTORS`/`SECTOR_COLORS`, `REFRESH` intervals, `THRESHOLDS`, `DATA_URLS`, plus the shared `escapeHtml`/`safeUrl` helpers all live here. Rule: configure here, never hardcode a value elsewhere in the codebase.

Two invariants worth knowing before touching this file:
- **CoinGecko IDs are verified via `/api/v3/search`, never guessed.** A wrong-but-plausible ID silently pulls the wrong asset. Known trap already fixed here: the CoinGecko id `flux` is a *different* token (Datamine FLUX) — the Flux/Zelcash tracked in this project is `zelcash`. Horizon (the other repo) may still have this wrong.
- **`THRESHOLDS.directionalMovePct` is the one and only "directional move" threshold, used everywhere** (backtest, confusion matrix, neutral-verdict evaluation). Never let a specific view use its own hardcoded threshold — the Macroscope prototype this project learned from did that (±3% on the confusion matrix vs ±10% on the "success by verdict" table) and it made the numbers incomparable.

### Trust boundary: escape/sanitize anything that isn't our own computed data

News summaries, AI-generated text, and the public CoinGecko API are all treated as untrusted for rendering purposes: any such text goes through `escapeHtml()` before `innerHTML`, and any URL from that kind of source goes through `safeUrl()` (blocks `javascript:`/`data:`, allows only `http(s):`) before being used as an `href`.

### Long analysis text is highlighted, not just escaped (`highlightKeyInfo`, `config.js`)

Verdict reasoning, the portfolio thesis, the engine's correction log, the digest, and every other multi-sentence analysis paragraph go through `highlightKeyInfo()` instead of a bare `escapeHtml()` before `innerHTML` — it escapes first (same trust-boundary rule as above, so swapping the two is always safe) then wraps key figures (%, $, €, decimal-comma numbers like "1,1 %") in a `.hl-stat` mark and "Bull :"/"Base :"/"Bear :" scenario labels in a color-coded `.hl-scenario` span, so a long paragraph can be scanned instead of read start to end (user complaint, 2026-08-31: dense text on the Portfolio/Favoris "Contexte élargi" panel — `detail.js`'s `renderFavorisContextSection`, *not* `portfolio-thesis.json`, despite the similar "Thèse long terme" heading — was impossible to skim on mobile). It's wired into essentially every tab: the digest/avis-du-jour/macro-regime/market-context notes on Accueil, the opportunity "reason" text, the engine's correction log and control-group notes, `detail.js`'s verdict opinion and "Contexte élargi" block (shared by Portfolio/Favoris/Opportunités), and the Assistant's own chat replies. Deliberately left out: browser push-notification bodies (`notify.js`, `sendBrowserNotification`) — the Notification API doesn't render HTML, so the `<mark>`/`<span>` tags would show up as literal text.

Two things that would silently break it if "simplified" back:
- **`<span>`, never `<strong>`, for the scenario label.** Several unrelated blocks (`.detail-opinion strong`, `.disclaimer-box strong`, `.detail-context strong`...) already style *every* `<strong>` in their container as a block-level label (`display:block`). A `<strong>` here would get cut onto its own line mid-sentence instead of staying inline.
- **The number pattern groups thousands by a lone space and decimals by a comma/period separately** (`\d{1,3}(?:\s\d{3})*(?:[.,]\d+)?`) — a single `[\d\s.,]+`-style pattern looks simpler but silently splits a French decimal like "1,1 %" into "1," + "1 %", because it treats the comma as a thousands separator requiring 2-3 trailing digits. Covered by a regression test in `config.test.js`.

In the Assistant (`js/assistant.js`, `appendChatMessage`), the highlight only applies to `role === "assistant"` — the user's own typed message stays on `textContent` exactly as before, never parsed as HTML. Losing that branch (e.g. applying `highlightKeyInfo` unconditionally) wouldn't open an XSS hole (it always escapes first) but it would be wrong: the user's own words aren't "analysis text" to decorate. Covered by a regression test in `assistant.test.js`.

### The access portal is a filter, not real security

`js/auth.js` + `ACCESS_HASH` in `config.js` gate the UI behind a SHA-256-hashed code. The repo is **public** (required for free GitHub Pages hosting and for cloud routines to commit directly to it), so the hash is visible in source and every file under `data/` is fetchable directly via the raw GitHub URL regardless of the portal. It only filters a visitor who stumbles on the link, not a determined one — don't treat it as an access-control boundary when making changes.

### AI relay for the Assistant (`cloudflare-worker/`) — AI-first, not a last resort

The Assistant (`js/assistant.js`) prioritizes **factual sourced data first** (a named tracked asset's real verdict, a glossary definition, a live CoinGecko lookup for an untracked asset — `buildAiContext()` doesn't have these, so AI would only guess), then sends everything else — any general, analytical, or conversational question, regardless of length — to the AI relay (`fetchLiveAiFallback()`) **before** trying a keyword match. This was a deliberate reversal from an earlier "rule-based first, AI as last resort" design: keyword-matching (`CHAT_INTENTS`) now exists only as a fallback for when the AI relay is unavailable, not as the default path — a keyword match answering *instead of* a real reading of the question was the exact bug users kept reporting ("il répond automatiquement sans rien analyser").

`fetchLiveAiFallback()` calls a small Cloudflare Worker that uses Workers AI (Cloudflare's own free-tier model hosting — no separate API key, no recurring cost within free-tier limits), grounded in real site data, never invented. This still doesn't force a server dependency: `AI_RELAY_URL` (`config.js`) defaults to an unconfigured placeholder, in which case `fetchLiveAiFallback` never makes a network call and the site falls straight through to the keyword fallback, behaving exactly as it did before the Worker existed.

**Critical deploy gotcha, learned the hard way:** the Worker's source lives in `cloudflare-worker/` in *this* repo, but Cloudflare Workers Builds (the git-connected auto-deploy) actually watches a **separate, dedicated GitHub repo**, `jaki2402-dev/aguilaradar-assistant-ia` — not this one. Editing `cloudflare-worker/worker.js` here and pushing to `main` changes nothing on the live Worker until that separate repo is *also* updated (`git clone` it, copy `worker.js`/`wrangler.jsonc`/`package.json`/`README.md` over, commit, push). Confirmed this session: that repo sat unsynced for 5+ days while push-notification work landed only here, so the deployed Worker kept 404/405-ing on routes that had existed in this repo's code the whole time. Also confirmed: Workers Builds on this account does **not** reliably auto-deploy on push (every prior deploy was "Manually deployed"/"Dashboard", never an automatic build) — after syncing the separate repo, still check the Cloudflare dashboard's Deployments tab and manually trigger a build if nothing appears within a minute or two.

### Data files (`data/*.json`)

Written by the scheduled routines, not by the frontend. Two files are **append-only** and must never be overwritten/reset by code that touches them:
- `verdicts.json` — one entry per verdict ever issued; `status` moves from `"pending"` to `"resolved"` only once `resolves_at` has actually passed. The UI must show "pending" rather than inventing an early outcome.
- `engine-history.json`'s `correction_log` — every engine self-adjustment attempt (what, why, before/after validation score, accepted/rejected). This is the engine's cross-run memory; `global_stats` in the same file is recomputed each cycle from resolved verdicts (accuracy, two baselines — majority-class guess and BTC buy&hold —, coverage, per-class F1, confusion matrix).

`opportunities.json` is a Top-300 screening with the CoinGecko "Meme" category excluded. `alerts.json` is threshold-driven (RSI, support/resistance break, order-book imbalance) from the fast pulse, independent of the deep-analysis cycle.

`portfolio.json` is the one exception to "written by the scheduled routines, not the frontend" above: it's edited by hand (by a human, or by Claude on the user's explicit request after they share updated holdings) — no routine ever writes qty/invested, only reads them, exactly like `js/portfolio.js` (client-side) only ever reads it to compute value/P&L live, never stores a computed number back. A position with `qty`/`invested` set to `null` and `pending: true` means the real numbers haven't been provided yet — render it as pending, never guess a figure to fill the gap.

`portfolio-thesis.json` (added 2026-08-26) is the **one file in this repo a Cowork routine writes directly**, by explicit user request, so the site and the Assistant have a real, web-researched medium-term view per position — distinct from the engine's own ~14-day technical verdict, which stays purely technical/backtested and must never be confused with this. Shape: `{ generated_at, positions: { <cgId>: { recommendation, conviction, constat } } }`, `recommendation` one of Renforcer/Conserver/Attendre/Réduire (case/accent-insensitive — `js/portfolio.js`'s `normalizeRecommendation()` maps it to an ASCII badge slug, falls back to plain text for anything else, never invents a badge for an unrecognized value). Absence of an entry for a given `cgId`, or of the file entirely, means no thesis yet — render nothing for it rather than a stale/guessed one. `js/assistant.js`'s `buildAiContext()` explicitly tells the AI relay when no thesis exists yet, specifically so it doesn't extrapolate one from the technical verdict — the whole point of this file existing is to stop that from happening.

`favoris-context.json` — refreshed periodically per favori, **keyed by ticker, not `cgId`** (the one data file that isn't — `js/portfolio.js` passes `p.ticker`, not `p.cgId`, to `detail.js`'s `renderFavorisContextSection(ticker)`). Shape per asset: `competitor` (`comparison_note` vs. a real-world analog), `long_term_thesis` (`bull`/`base`/`bear`/`assumptions_note`), `open_interest`, `defi_tvl`, `onchain_signal`. Rendered under the "Thèse long terme" heading inside `renderFavorisContextSection`'s "Contexte élargi" block — shared by Portfolio/Favoris/Opportunités, unlike `portfolio-thesis.json` above which is Portfolio-only. **Easy to confuse the two — a real mistake made in this repo, 2026-08-31**: a user complaint about dense, hard-to-scan "Thèse long terme" text got fixed against `portfolio-thesis.json`'s `constat` first, because that file *is* documented right above and *sounds* like the match — but the actual text the user saw (a `Bull :`/`Base :`/`Bear :` split, not a single paragraph) renders from *this* file instead, and the fix had to be redone against the right one. Tell them apart by shape, not by name: a single `constat` paragraph + a Renforcer/Conserver/Attendre/Réduire badge → `portfolio-thesis.json`; a `bull`/`base`/`bear` split with no recommendation badge, visible on Favoris/Opportunités too → `favoris-context.json`.

**Cowork routines gotcha, same shape as the Cloudflare Worker one above:** `briefing-crypto-hebdo-cloud` (weekly) and `alerte-crypto-quotidienne-cloud` (every 4h), which email the user's portfolio, live entirely as Cowork trigger config (`update_trigger`/`list_triggers`), not as files in this repo — their prompt text, cadence, and email design live outside this repo and won't show up in a diff or `git log`. Both fetch `data/portfolio.json` read-only via the `raw.githubusercontent.com` URL (same pattern as `aguilaradar-briefing-email-quotidien`); `briefing-crypto-hebdo-cloud` additionally has real git write access (attached repo + coding tools, granted through the Routines UI — `update_trigger` cannot grant this from an agent session for a routine it didn't create) specifically and *only* to write `data/portfolio-thesis.json` each week — its prompt explicitly forbids touching any other file, and `alerte-crypto-quotidienne-cloud` keeps the narrower WebSearch/WebFetch-only, no-repo-access scope it always had. A third, unrelated routine (`aguilaradar-briefing-email-quotidien`, daily) reads this repo's `digest.json`/`alerts.json`/`engine-history.json` for a pure market-analysis email — it carries no portfolio data and should stay read-only.
