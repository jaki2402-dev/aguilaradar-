# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

aguilaradar is a static crypto market radar dashboard: continuous market analysis, timestamped verdicts, a backtest engine that self-evaluates and self-corrects. It is deliberately separate from Horizon (a personal portfolio dashboard, different repo) — aguilaradar holds no personal € amounts, only general market analysis.

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

### The access portal is a filter, not real security

`js/auth.js` + `ACCESS_HASH` in `config.js` gate the UI behind a SHA-256-hashed code. The repo is **public** (required for free GitHub Pages hosting and for cloud routines to commit directly to it), so the hash is visible in source and every file under `data/` is fetchable directly via the raw GitHub URL regardless of the portal. It only filters a visitor who stumbles on the link, not a determined one — don't treat it as an access-control boundary when making changes.

### Optional free AI relay for the Assistant (`cloudflare-worker/`)

The Assistant (`js/assistant.js`) is rule-based by default (no AI call, see its own header comment) — but has one **optional, opt-in** last-resort fallback: `fetchLiveAiFallback()` calls a small Cloudflare Worker (`cloudflare-worker/worker.js`, deploy steps in that folder's `README.md`) that uses Workers AI (Cloudflare's own free-tier model hosting — no separate API key, no recurring cost within free-tier limits) to answer questions nothing else could handle, grounded in real site data (`buildAiContext()`), never invented. This does **not** change the "no server required" baseline: `AI_RELAY_URL` (`config.js`) defaults to an unconfigured placeholder, in which case `fetchLiveAiFallback` never makes a network call and the site behaves exactly as if this didn't exist. It is also never allowed to override an already-working rule-based answer (tracked asset, glossary, live search, known intent) — it only fires after every one of those has already failed, so it can only add coverage, never regress it.

### Data files (`data/*.json`)

Written by the scheduled routines, not by the frontend. Two files are **append-only** and must never be overwritten/reset by code that touches them:
- `verdicts.json` — one entry per verdict ever issued; `status` moves from `"pending"` to `"resolved"` only once `resolves_at` has actually passed. The UI must show "pending" rather than inventing an early outcome.
- `engine-history.json`'s `correction_log` — every engine self-adjustment attempt (what, why, before/after validation score, accepted/rejected). This is the engine's cross-run memory; `global_stats` in the same file is recomputed each cycle from resolved verdicts (accuracy, two baselines — majority-class guess and BTC buy&hold —, coverage, per-class F1, confusion matrix).

`opportunities.json` is a Top-300 screening with the CoinGecko "Meme" category excluded. `alerts.json` is threshold-driven (RSI, support/resistance break, order-book imbalance) from the fast pulse, independent of the deep-analysis cycle.
