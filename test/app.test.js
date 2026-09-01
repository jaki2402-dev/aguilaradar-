import { describe, it, expect, beforeEach } from "vitest";
import { loadPage, runScript, getGlobal } from "./helpers/loadPage.js";

// updateFreshnessIndicator ne dépend de "maintenant" que via Date.now() (les new Date(t)
// du code, eux, reçoivent toujours un argument et gardent leur vrai comportement). Note :
// vi.useFakeTimers() de Vitest ne suffit pas ici — il patche le Date du realm Node ambiant,
// pas le Date du contexte JSDOM séparé créé par loadPage (vérifié). On fige donc
// directement window.Date.now sur la page chargée.
function freezeNow(dom, iso) {
  const fixed = new Date(iso).getTime();
  dom.window.Date.now = () => fixed;
  return fixed;
}

describe("app.js — updateFreshnessIndicator (régression 4d520ad, puis régression du 17/08 sur les cadences par source)", () => {
  const NOW_ISO = "2026-08-17T12:00:00Z";
  let dom, el;

  beforeEach(() => {
    dom = loadPage(["app.js"], { html: `<!doctype html><html><body><div id="last-deep-cycle"></div></body></html>` });
    freezeNow(dom, NOW_ISO);
    el = dom.window.document.getElementById("last-deep-cycle");
  });

  it("shows the 'not configured' message when no source has a timestamp", () => {
    dom.window.updateFreshnessIndicator({}, {}, {});
    expect(el.textContent).toBe("Automatisation pas encore activée — routine programmée à configurer.");
    expect(el.className).toBe("");
  });

  it("reads routine_health.last_success_at, updated on every successful deep cycle regardless of whether anything changed", () => {
    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T11:00:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-ok")).toBe(true);
  });

  it("reads opportunities.last_scan_at on its own weekly-cadence thresholds when it is the only source present", () => {
    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-17T11:00:00Z" }, {}); // 1h — trivialement frais pour un rythme hebdomadaire
    expect(el.classList.contains("freshness-ok")).toBe(true);
    expect(el.textContent).toContain("Criblage opportunités");
  });

  it("reads news.last_updated_at when it is the only source present", () => {
    dom.window.updateFreshnessIndicator({}, {}, { last_updated_at: "2026-08-17T11:00:00Z" }); // 1h
    expect(el.classList.contains("freshness-ok")).toBe(true);
    expect(el.textContent).toContain("Actualités");
  });

  it("régression du 17/08 — un routine_health frais ne doit plus masquer une veille actualités obsolète sur son propre rythme ~2h", () => {
    // Cas réel du 17/08 : cycle macro/verdicts frais (tourne toutes les 2h) pendant que la
    // veille actualités n'avait rien écrit depuis 8h. Avant ce correctif, prendre le
    // timestamp le plus récent des sources affichait "à jour" et masquait le blocage.
    dom.window.updateFreshnessIndicator(
      { routine_health: { last_success_at: "2026-08-17T11:00:00Z" } }, // 1h — frais
      {},
      { last_updated_at: "2026-08-17T04:00:00Z" } // 8h — obsolète pour une source ~2h
    );
    expect(el.classList.contains("freshness-stale")).toBe(true);
    expect(el.textContent).toContain("Actualités");
    expect(el.textContent).toContain("⚠");
  });

  it("prefers news.last_checked_at over last_updated_at — une veille qui n'a rien trouvé de nouveau ne doit pas être signalée bloquée", () => {
    // Cas réel du 25/08 : le cycle profond refait sa veille actualités à chaque passage mais
    // n'ajoute une entrée que si c'est réellement nouveau (correctif concision du 17/08) —
    // last_updated_at peut donc rester ancien plusieurs cycles de suite sans que ce soit un
    // échec. last_checked_at, lui, avance à chaque veille effectuée, qu'une entrée soit
    // ajoutée ou non ; c'est donc lui qui doit determiner la fraîcheur affichée.
    dom.window.updateFreshnessIndicator(
      {},
      {},
      { last_updated_at: "2026-08-17T02:00:00Z", last_checked_at: "2026-08-17T11:00:00Z" } // updated_at 10h (obsolète seul), checked_at 1h
    );
    expect(el.classList.contains("freshness-ok")).toBe(true);
  });

  it("retombe sur last_updated_at si last_checked_at est absent (compatibilité avec les cycles avant le 25/08)", () => {
    dom.window.updateFreshnessIndicator({}, {}, { last_updated_at: "2026-08-17T04:00:00Z" }); // 8h, pas de last_checked_at
    expect(el.classList.contains("freshness-stale")).toBe(true);
  });

  it("régression du 17/08 — un routine_health frais ne doit plus masquer un criblage d'opportunités obsolète sur son propre rythme hebdomadaire", () => {
    // Cas réel du 17/08 : opportunities.last_scan_at figé depuis le 07/08 (criblage repris
    // par une routine hebdomadaire dédiée) pendant que routine_health continuait de tourner
    // toutes les 2h — l'ancien indicateur (timestamp le plus récent des deux) affichait
    // "à jour" en continu pendant des jours.
    dom.window.updateFreshnessIndicator(
      { routine_health: { last_success_at: "2026-08-17T11:00:00Z" } }, // 1h — frais
      { last_scan_at: "2026-08-06T12:00:00Z" }, // 11 jours — obsolète pour une cadence hebdomadaire
      {}
    );
    expect(el.classList.contains("freshness-stale")).toBe(true);
    expect(el.textContent).toContain("Criblage opportunités");
    expect(el.textContent).toContain("j");
  });

  it("does not read engineHistory.global_stats.last_computed_at at all (that was the original bug: it stays stale across cycles that resolved nothing)", () => {
    dom.window.updateFreshnessIndicator(
      { global_stats: { last_computed_at: "2026-08-17T11:59:00Z" } }, // tres frais mais ne doit pas etre lu
      {},
      {}
    );
    // Aucun timestamp reconnu (routine_health/opportunities/news absents) -> message "pas
    // configuree", meme si global_stats.last_computed_at est tres recent.
    expect(el.textContent).toBe("Automatisation pas encore activée — routine programmée à configurer.");
  });

  it("routine_health : 'ok' at exactly 3 hours, 'warning' just past it", () => {
    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T09:00:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-ok")).toBe(true);

    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T08:59:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-warning")).toBe(true);
  });

  it("routine_health : 'warning' at exactly 6 hours, 'stale' (with a warning glyph) just past it", () => {
    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T06:00:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-warning")).toBe(true);

    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T05:59:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-stale")).toBe(true);
    expect(el.textContent).toContain("⚠");
    expect(el.textContent).toContain("routine semble bloquée");
  });

  it("opportunities : 'ok' up to 8 days, 'warning' between 8 and 10 days, 'stale' past 10 days", () => {
    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-09T12:00:00Z" }, {}); // 8j pile
    expect(el.classList.contains("freshness-ok")).toBe(true);

    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-09T11:00:00Z" }, {}); // 8j + 1h
    expect(el.classList.contains("freshness-warning")).toBe(true);

    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-07T13:00:00Z" }, {}); // 9j23h
    expect(el.classList.contains("freshness-warning")).toBe(true);

    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-07T11:00:00Z" }, {}); // 10j1h
    expect(el.classList.contains("freshness-stale")).toBe(true);
  });

  it("shows the single worst source when several are degraded, ranked stale > warning > ok", () => {
    dom.window.updateFreshnessIndicator(
      { routine_health: { last_success_at: "2026-08-17T08:00:00Z" } }, // 4h — warning
      { last_scan_at: "2026-08-07T00:00:00Z" }, // 10j12h — stale
      { last_updated_at: "2026-08-17T11:00:00Z" } // 1h — ok
    );
    expect(el.classList.contains("freshness-stale")).toBe(true);
    expect(el.textContent).toContain("Criblage opportunités");
  });
});

// Fixture couvrant tous les ids DOM que les fonctions de rendu de app.js touchent — sous-
// ensemble fidèle de index.html (mêmes ids/classes), pour que attachDetailToggle/insights.js/
// cards.js s'y comportent exactement comme sur la vraie page.
const APP_FIXTURE_HTML = `<!doctype html><html><body>
  <span id="last-price-update"></span>
  <nav class="tabs">
    <button data-tab="overview" class="active"><span class="tab-label">Accueil</span></button>
    <button data-tab="portfolio"><span class="tab-label">Portefeuille</span></button>
    <button data-tab="favoris"><span class="tab-label">Favoris</span></button>
    <button data-tab="opportunities"><span class="tab-label">Opportunités</span></button>
    <button data-tab="journal"><span class="tab-label">Journal</span></button>
    <button data-tab="engine"><span class="tab-label">Moteur</span></button>
    <button data-tab="notifications"><span class="tab-label">Alertes</span></button>
    <button data-tab="assistant"><span class="tab-label">Assistant</span></button>
  </nav>
  <section id="tab-overview" class="tab-panel active">
    <div id="avis-du-jour"></div>
    <div id="macro-regime-banner"></div>
    <div class="hero-stat-value" id="hero-verdicts">0</div>
    <div class="hero-stat-value" id="hero-alerts">0</div>
    <div id="news-body"></div>
    <div id="accueil-highlights"></div>
  </section>
  <section id="tab-portfolio" class="tab-panel"><div id="portfolio-totals"></div><div id="portfolio-body"></div></section>
  <section id="tab-favoris" class="tab-panel"><div id="favoris-grid"></div></section>
  <section id="tab-opportunities" class="tab-panel"><div id="opportunities-body"></div></section>
  <section id="tab-journal" class="tab-panel"><div id="journal-body"></div></section>
  <section id="tab-engine" class="tab-panel"></section>
  <section id="tab-notifications" class="tab-panel"><div id="notifications-body"></div></section>
  <section id="tab-assistant" class="tab-panel"></section>
</body></html>`;

describe("app.js — switchTab", () => {
  let dom;

  beforeEach(() => {
    dom = loadPage(["config.js", "app.js"], { html: APP_FIXTURE_HTML });
  });

  it("activates the target tab panel and nav button, deactivating the previously active ones", () => {
    dom.window.switchTab("journal");
    expect(dom.window.document.getElementById("tab-journal").classList.contains("active")).toBe(true);
    expect(dom.window.document.querySelector('[data-tab="journal"]').classList.contains("active")).toBe(true);
    expect(dom.window.document.getElementById("tab-overview").classList.contains("active")).toBe(false);
    expect(dom.window.document.querySelector('[data-tab="overview"]').classList.contains("active")).toBe(false);
  });

  it("only ever keeps one tab panel active at a time across all 7 tabs", () => {
    dom.window.switchTab("engine");
    const activePanels = dom.window.document.querySelectorAll(".tab-panel.active");
    expect(activePanels).toHaveLength(1);
    expect(activePanels[0].id).toBe("tab-engine");
  });

  it("calls notifyTabActive with the tab id when it is present on window", () => {
    let calledWith = null;
    dom.window.notifyTabActive = (id) => { calledWith = id; };
    dom.window.switchTab("favoris");
    expect(calledWith).toBe("favoris");
  });

  it("does not throw when notifyTabActive is absent (background-fx.js not loaded, guarded by if (window.notifyTabActive))", () => {
    expect(() => dom.window.switchTab("favoris")).not.toThrow();
  });

  it("clears the notification bell badge only when switching to the notifications tab, never for other tabs", () => {
    let cleared = false;
    dom.window.clearNotifBellBadge = () => { cleared = true; };
    dom.window.switchTab("journal");
    expect(cleared).toBe(false);
    dom.window.switchTab("notifications");
    expect(cleared).toBe(true);
  });
});

describe("app.js — renderFavorisGrid", () => {
  let dom;

  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "cards.js", "detail.js", "app.js"], { html: APP_FIXTURE_HTML });
  });

  it("renders exactly one tile per tracked favori", () => {
    dom.window.renderFavorisGrid();
    const FAVORIS = getGlobal(dom, "FAVORIS");
    expect(dom.window.document.querySelectorAll("#favoris-grid .favori-tile")).toHaveLength(FAVORIS.length);
  });

  it("renders the ticker on the tile, and the full name/sector in its title tooltip (dense grid: kept out of the tile itself)", () => {
    dom.window.renderFavorisGrid();
    const tiles = dom.window.document.querySelectorAll("#favoris-grid .favori-tile");
    const FAVORIS = getGlobal(dom, "FAVORIS");
    const SECTORS = getGlobal(dom, "SECTORS");
    FAVORIS.forEach((f, i) => {
      expect(tiles[i].querySelector(".favori-tile-tick").textContent).toBe(f.ticker);
      expect(tiles[i].getAttribute("title")).toBe(`${f.name} — ${SECTORS[f.cgId] || ""}`);
    });
  });

  it("makes every tile keyboard-clickable via attachDetailToggle (tabindex + role=button)", () => {
    dom.window.renderFavorisGrid();
    const first = dom.window.document.querySelector("#favoris-grid .favori-tile");
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(first.getAttribute("role")).toBe("button");
  });

  it("gives every tile its own detail panel id — no collision between favoris", () => {
    dom.window.renderFavorisGrid();
    const ids = Array.from(dom.window.document.querySelectorAll("#favoris-grid .detail-panel")).map((p) => p.id);
    expect(new Set(ids).size).toBe(getGlobal(dom, "FAVORIS").length);
    expect(ids).toContain("detail-fav-BTC");
  });
});

describe("app.js — refreshPrices (flash de prix quand le prix vient réellement de bouger)", () => {
  let dom;

  function stubPrices(eur, eur_24h_change = 1) {
    dom.window.fetch = async () => ({ ok: true, json: async () => ({ bitcoin: { eur, eur_24h_change } }) });
  }

  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "cards.js", "detail.js", "app.js"], { html: APP_FIXTURE_HTML });
    dom.window.renderFavorisGrid();
  });

  it("does not flash on the very first refresh (nothing to compare against yet)", async () => {
    stubPrices(50000);
    await dom.window.refreshPrices();
    const priceEl = dom.window.document.getElementById("price-BTC");
    expect(priceEl.classList.contains("price-flash-up")).toBe(false);
    expect(priceEl.classList.contains("price-flash-down")).toBe(false);
  });

  it("flashes up when the price rises between two refreshes", async () => {
    stubPrices(50000);
    await dom.window.refreshPrices();
    stubPrices(51000);
    await dom.window.refreshPrices();
    const priceEl = dom.window.document.getElementById("price-BTC");
    expect(priceEl.classList.contains("price-flash-up")).toBe(true);
    expect(priceEl.classList.contains("price-flash-down")).toBe(false);
  });

  it("flashes down when the price falls between two refreshes", async () => {
    stubPrices(50000);
    await dom.window.refreshPrices();
    stubPrices(49000);
    await dom.window.refreshPrices();
    const priceEl = dom.window.document.getElementById("price-BTC");
    expect(priceEl.classList.contains("price-flash-down")).toBe(true);
    expect(priceEl.classList.contains("price-flash-up")).toBe(false);
  });

  it("does not flash when the price is unchanged between two refreshes", async () => {
    stubPrices(50000);
    await dom.window.refreshPrices();
    stubPrices(50000);
    await dom.window.refreshPrices();
    const priceEl = dom.window.document.getElementById("price-BTC");
    expect(priceEl.classList.contains("price-flash-up")).toBe(false);
    expect(priceEl.classList.contains("price-flash-down")).toBe(false);
  });
});

describe("app.js — applyHeatTint (teinte de fond des tuiles Favoris selon la variation 24h)", () => {
  let dom, tile;

  beforeEach(() => {
    dom = loadPage(["config.js", "app.js"], { html: `<!doctype html><html><body><div class="favori-tile"></div></body></html>` });
    tile = dom.window.document.querySelector(".favori-tile");
  });

  it("does nothing (no throw) when given a null element", () => {
    expect(() => dom.window.applyHeatTint(null, 3)).not.toThrow();
  });

  it("uses THRESHOLDS.directionalMovePct (5%) as the tier boundary, not a separate hardcoded value", () => {
    dom.window.applyHeatTint(tile, 5);
    expect(tile.classList.contains("heat-pos-3")).toBe(true);
    dom.window.applyHeatTint(tile, 4.99);
    expect(tile.classList.contains("heat-pos-2")).toBe(true);
  });

  it.each([
    [1, "heat-pos-1"],
    [2.5, "heat-pos-2"],
    [7, "heat-pos-3"],
    [-1, "heat-neg-1"],
    [-2.5, "heat-neg-2"],
    [-7, "heat-neg-3"],
  ])("tags a %s%% change as %s", (pct, expectedClass) => {
    dom.window.applyHeatTint(tile, pct);
    expect(tile.className).toBe(`favori-tile ${expectedClass}`);
  });

  it("removes the previous tier before applying a new one, never stacking classes across refreshes", () => {
    dom.window.applyHeatTint(tile, 7);
    expect(tile.classList.contains("heat-pos-3")).toBe(true);
    dom.window.applyHeatTint(tile, -1);
    expect(tile.classList.contains("heat-pos-3")).toBe(false);
    expect(tile.classList.contains("heat-neg-1")).toBe(true);
    expect(tile.className).toBe("favori-tile heat-neg-1");
  });
});

describe("app.js — updateFavorisVerdicts", () => {
  let dom;

  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "cards.js", "detail.js", "app.js"], { html: APP_FIXTURE_HTML });
    dom.window.renderFavorisGrid();
  });

  it("sets the badge and the card's reasoning/verdict dataset for a favori with a verdict", () => {
    dom.window.updateFavorisVerdicts([
      { asset: "bitcoin", verdict: "ACHAT", reasoning: "RSI bas, MM20 > MM50", issued_at: "2026-08-17T10:00:00Z" },
    ]);
    const badge = dom.window.document.getElementById("verdict-BTC");
    expect(badge.querySelector(".badge").textContent).toBe("ACHAT");
    expect(badge.querySelector(".badge").className).toBe("badge badge-achat");
    const card = badge.closest(".favori-tile");
    expect(card.dataset.verdict).toBe("ACHAT");
    expect(card.dataset.reasoning).toBe("RSI bas, MM20 > MM50");
  });

  it("leaves the badge empty for a favori with no verdict at all", () => {
    dom.window.updateFavorisVerdicts([{ asset: "bitcoin", verdict: "ACHAT", reasoning: "x", issued_at: "2026-08-17T10:00:00Z" }]);
    expect(dom.window.document.getElementById("verdict-ETH").innerHTML).toBe("");
  });

  it("picks the most recent verdict by issued_at when an asset has several, not just the array's last entry", () => {
    dom.window.updateFavorisVerdicts([
      { asset: "bitcoin", verdict: "ACHAT", reasoning: "récent", issued_at: "2026-08-17T00:00:00Z" },
      { asset: "bitcoin", verdict: "VENTE", reasoning: "vieux", issued_at: "2026-08-15T00:00:00Z" },
    ]);
    const badge = dom.window.document.getElementById("verdict-BTC");
    expect(badge.querySelector(".badge").textContent).toBe("ACHAT");
    expect(badge.closest(".favori-tile").dataset.reasoning).toBe("récent");
  });

  it("handles an empty verdicts array without throwing", () => {
    expect(() => dom.window.updateFavorisVerdicts([])).not.toThrow();
  });
});

describe("app.js — renderOpportunities", () => {
  let dom;

  function opp(ticker, overrides = {}) {
    return {
      id: ticker,
      ticker,
      name: ticker,
      cgId: ticker.toLowerCase(),
      price_eur: 1,
      change_24h_pct: 1,
      change_7d_pct: 1,
      change_30d_pct: 1,
      market_cap: 1e9,
      ...overrides,
    };
  }

  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "cards.js", "detail.js", "app.js"], { html: APP_FIXTURE_HTML });
    // constellationControllers est normalement déclaré par background-fx.js (canvas décoratif,
    // hors périmètre des tests — voir CLAUDE.md) : on stub juste l'objet que renderOpportunities lit.
    runScript(dom, "var constellationControllers = {};", "stub constellationControllers");
  });

  it("renders every opportunity into #opportunities-body", () => {
    dom.window.renderOpportunities({ opportunities: [opp("AAA"), opp("BBB"), opp("CCC")] });
    expect(dom.window.document.querySelectorAll("#opportunities-body .opp-tile")).toHaveLength(3);
  });

  it("mirrors only the top 3 (by confidence) into #accueil-highlights (full .opp-card) while the full list stays in #opportunities-body (dense .opp-tile)", () => {
    const items = [opp("AAA"), opp("BBB"), opp("CCC"), opp("DDD"), opp("EEE")];
    dom.window.renderOpportunities({ opportunities: items });
    expect(dom.window.document.querySelectorAll("#accueil-highlights .opp-card")).toHaveLength(3);
    expect(dom.window.document.querySelectorAll("#opportunities-body .opp-tile")).toHaveLength(5);
  });

  it("highlights a key figure in the opportunity's reason text (.opp-card, highlightKeyInfo not a bare escapeHtml)", () => {
    dom.window.renderOpportunities({ opportunities: [opp("AAA", { reason: "Rebond de 15 % sur 7 jours, volume en hausse." })] });
    expect(dom.window.document.querySelector("#accueil-highlights .opp-card mark.hl-stat").textContent).toBe("15 %");
  });

  it("records the rendered tickers, in input order, for the opportunities constellation", () => {
    dom.window.renderOpportunities({ opportunities: [opp("AAA"), opp("BBB")] });
    expect(getGlobal(dom, "latestOpportunityTickers")).toEqual(["AAA", "BBB"]);
  });

  it("shows the empty state and does not throw when there are no opportunities yet", () => {
    expect(() => dom.window.renderOpportunities({ opportunities: [] })).not.toThrow();
    expect(dom.window.document.getElementById("opportunities-body").textContent).toContain("Aucun screening");
  });

  it("does not throw when the data itself is null (not loaded yet)", () => {
    expect(() => dom.window.renderOpportunities(null)).not.toThrow();
  });
});

describe("app.js — renderOpportunityTiles (grille dense #opportunities-body, esprit Coin360)", () => {
  let dom;

  function opp(ticker, overrides = {}) {
    return {
      id: ticker,
      ticker,
      name: ticker,
      cgId: ticker.toLowerCase(),
      price_eur: 1,
      change_24h_pct: 1,
      change_7d_pct: 1,
      change_30d_pct: 1,
      market_cap: 1e9,
      ...overrides,
    };
  }

  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "cards.js", "detail.js", "app.js"], { html: APP_FIXTURE_HTML });
    runScript(dom, "var constellationControllers = {};", "stub constellationControllers");
  });

  it("collapsed tile shows only ticker/confidence/price/change — the rich content (name, gauge, tags, footer) lives in .opp-tile-body, not directly in the tile", () => {
    dom.window.renderOpportunities({ opportunities: [opp("AAA", { tags: ["Un tag"] })] });
    const tile = dom.window.document.querySelector("#opportunities-body .opp-tile");
    expect(tile.querySelector(".favori-tile-tick").textContent).toBe("AAA");
    expect(tile.querySelector(".favori-tile-price")).not.toBeNull();
    const body = tile.querySelector(".opp-tile-body");
    expect(body).not.toBeNull();
    expect(body.querySelector(".opp-name").textContent).toBe("AAA");
    expect(body.querySelector(".tag").textContent).toBe("Un tag");
  });

  it("applies a heat-tint class from the 24h change, same tiers as Favoris", () => {
    dom.window.renderOpportunities({ opportunities: [opp("UP", { change_24h_pct: 12 }), opp("DOWN", { change_24h_pct: -12 })] });
    const tiles = dom.window.document.querySelectorAll("#opportunities-body .opp-tile");
    expect(tiles[0].classList.contains("heat-pos-3")).toBe(true);
    expect(tiles[1].classList.contains("heat-neg-3")).toBe(true);
  });

  it("wires each tile to attachDetailToggle (keyboard-clickable, expands to reveal .opp-tile-body via CSS)", () => {
    dom.window.renderOpportunities({ opportunities: [opp("AAA")] });
    const tile = dom.window.document.querySelector("#opportunities-body .opp-tile");
    expect(tile.getAttribute("role")).toBe("button");
    tile.click();
    expect(tile.classList.contains("expanded")).toBe(true);
  });

  it("colors the confidence badge using the same thresholds as the full gauge (confidenceColor)", () => {
    // market_cap_rank <= 100 (+30) + recognized (+20) + mouvement 7j sous 30% (+10) = 100 -> plafonné a 95, >=75 -> --gain
    dom.window.renderOpportunities({ opportunities: [opp("HI", { market_cap_rank: 10, recognized: true })] });
    const conf = dom.window.document.querySelector("#opportunities-body .opp-tile-conf");
    expect(conf.getAttribute("style")).toContain("var(--gain)");
  });

  it("shows the same empty state as the Overview teaser when there are no opportunities", () => {
    dom.window.renderOpportunities({ opportunities: [] });
    expect(dom.window.document.getElementById("opportunities-body").textContent).toContain("Aucun screening");
  });
});

describe("app.js — renderJournal / renderJournalPage", () => {
  let dom;

  function verdict(i, overrides = {}) {
    return {
      id: `v${i}`,
      asset: "bitcoin",
      ticker: "BTC",
      verdict: "ACHAT",
      reasoning: `Raisonnement ${i}`,
      confidence_pct: 70,
      horizon_days: 7,
      status: "resolved",
      issued_at: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      ...overrides,
    };
  }

  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "cards.js", "detail.js", "insights.js", "app.js"], { html: APP_FIXTURE_HTML });
  });

  it("shows the empty state and does not throw with no verdicts", () => {
    dom.window.renderJournal([]);
    expect(dom.window.document.getElementById("journal-body").textContent).toContain("Aucun verdict émis");
  });

  it("renders newest first (reverse of input order)", () => {
    dom.window.renderJournal([verdict(0), verdict(1), verdict(2)]);
    const entries = dom.window.document.querySelectorAll("#journal-body .journal-entry");
    expect(entries[0].querySelector("p").textContent).toBe("Raisonnement 2");
  });

  it("escapes reasoning before inserting it (trust boundary — reasoning can carry AI-generated text)", () => {
    dom.window.renderJournal([verdict(0, { reasoning: "<img src=x onerror=alert(1)>" })]);
    const el = dom.window.document.getElementById("journal-body");
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("shows a provisional badge only for a pending verdict when a live price is available, never for a resolved one", () => {
    runScript(dom, `latestFavorisPrices = ${JSON.stringify({ bitcoin: { eur: 55000 } })};`, "seed latestFavorisPrices");
    dom.window.renderJournal([
      verdict(0, { status: "resolved", price_at_issue: 50000 }),
      verdict(1, { status: "pending", price_at_issue: 50000 }),
    ]);
    const entries = dom.window.document.querySelectorAll("#journal-body .journal-entry");
    // entries[0] est le plus récent (index 1, pending) une fois l'ordre inversé.
    expect(entries[0].innerHTML).toContain("Tendance provisoire");
    expect(entries[1].innerHTML).not.toContain("Tendance provisoire");
  });

  it("does not paginate under the 15-item page size — no 'load more' link", () => {
    dom.window.renderJournal(Array.from({ length: 15 }, (_, i) => verdict(i)));
    expect(dom.window.document.getElementById("journal-load-more")).toBeNull();
  });

  it("paginates past 15 items, and clicking 'load more' reveals the rest", () => {
    dom.window.renderJournal(Array.from({ length: 17 }, (_, i) => verdict(i)));
    expect(dom.window.document.querySelectorAll("#journal-body .journal-entry")).toHaveLength(15);
    const loadMore = dom.window.document.getElementById("journal-load-more");
    expect(loadMore).not.toBeNull();
    expect(loadMore.textContent).toContain("2 verdict");

    loadMore.click();
    expect(dom.window.document.querySelectorAll("#journal-body .journal-entry")).toHaveLength(17);
    expect(dom.window.document.getElementById("journal-load-more")).toBeNull();
  });

  it("resets pagination back to page 1 on a fresh renderJournal call (e.g. after a refresh)", () => {
    dom.window.renderJournal(Array.from({ length: 17 }, (_, i) => verdict(i)));
    dom.window.document.getElementById("journal-load-more").click();
    expect(dom.window.document.querySelectorAll("#journal-body .journal-entry")).toHaveLength(17);

    dom.window.renderJournal(Array.from({ length: 17 }, (_, i) => verdict(i)));
    expect(dom.window.document.querySelectorAll("#journal-body .journal-entry")).toHaveLength(15);
  });

  it("wires each entry to attachDetailToggle (keyboard-clickable, own detail panel)", () => {
    dom.window.renderJournal([verdict(0)]);
    const entry = dom.window.document.querySelector("#journal-body .journal-entry");
    expect(entry.getAttribute("role")).toBe("button");
    expect(entry.getAttribute("tabindex")).toBe("0");
  });
});

describe("app.js — renderNotifications / renderNotificationsPage", () => {
  let dom;

  function alertItem(i, overrides = {}) {
    return {
      id: `a${i}`,
      type: "seuil_technique",
      ticker_ou_theme: "BTC",
      message: `Message ${i}`,
      triggered_at: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      ...overrides,
    };
  }

  beforeEach(() => {
    dom = loadPage(["config.js", "app.js"], { html: APP_FIXTURE_HTML });
  });

  it("shows the empty state for no alerts, whether null or an empty array", () => {
    dom.window.renderNotifications(null);
    expect(dom.window.document.getElementById("notifications-body").textContent).toContain("Aucune alerte active");
    dom.window.renderNotifications([]);
    expect(dom.window.document.getElementById("notifications-body").textContent).toContain("Aucune alerte active");
  });

  it("renders newest first and maps known alert types to their French label", () => {
    dom.window.renderNotifications([alertItem(0, { type: "opportunite" }), alertItem(1, { type: "signal_precoce" })]);
    const entries = dom.window.document.querySelectorAll("#notifications-body .alert-entry");
    expect(entries[0].querySelector(".badge").textContent).toBe("Signal précoce");
    expect(entries[1].querySelector(".badge").textContent).toBe("Opportunité");
  });

  it("falls back to the raw type string for an unrecognized alert type", () => {
    dom.window.renderNotifications([alertItem(0, { type: "type_inconnu_futur" })]);
    expect(dom.window.document.querySelector("#notifications-body .badge").textContent).toBe("type_inconnu_futur");
  });

  it("shows a bullish/bearish/neutral sentiment badge alongside the type badge when the routine provided one", () => {
    dom.window.renderNotifications([
      alertItem(0, { sentiment: "positif" }),
      alertItem(1, { sentiment: "négatif" }),
      alertItem(2, { sentiment: "neutre" }),
    ]);
    // renderNotifications affiche du plus récent au plus ancien (.reverse()) : entries[0] est
    // donc alertItem(2), entries[2] est alertItem(0).
    const entries = dom.window.document.querySelectorAll("#notifications-body .alert-entry");
    expect(entries[0].querySelectorAll(".badge")[0].textContent).toBe("Neutre");
    expect(entries[1].querySelectorAll(".badge")[0].textContent).toContain("Bearish");
    expect(entries[2].querySelectorAll(".badge")[0].textContent).toContain("Bullish");
    // Le badge de type reste présent en plus, jamais remplacé par le sentiment (alertItem()
    // par défaut : type "seuil_technique" -> "Seuil technique").
    expect(entries[0].textContent).toContain("Seuil technique");
  });

  it("shows only the type badge (no phantom sentiment badge) when the routine didn't compute one for this alert", () => {
    dom.window.renderNotifications([alertItem(0)]);
    const entry = dom.window.document.querySelector("#notifications-body .alert-entry");
    expect(entry.querySelectorAll(".badge")).toHaveLength(1);
  });

  it("escapes message and source before inserting them (trust boundary)", () => {
    dom.window.renderNotifications([alertItem(0, { message: "<b>x</b>", source: "<img src=x onerror=alert(1)>" })]);
    const el = dom.window.document.getElementById("notifications-body");
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<b>x</b>");
    expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("omits the source line entirely when no source is given", () => {
    dom.window.renderNotifications([alertItem(0, { source: undefined })]);
    expect(dom.window.document.getElementById("notifications-body").textContent).not.toContain("Source :");
  });

  it("shows a permanent-history total footer once every alert fits on a single page", () => {
    dom.window.renderNotifications([alertItem(0), alertItem(1)]);
    expect(dom.window.document.getElementById("notifications-body").textContent).toContain("2 alerte(s) au total");
  });

  it("paginates past 15 items, and clicking 'load more' reveals the rest, restoring the total footer once exhausted", () => {
    dom.window.renderNotifications(Array.from({ length: 17 }, (_, i) => alertItem(i)));
    expect(dom.window.document.querySelectorAll("#notifications-body .alert-entry")).toHaveLength(15);
    const loadMore = dom.window.document.getElementById("notifications-load-more");
    expect(loadMore).not.toBeNull();

    loadMore.click();
    expect(dom.window.document.querySelectorAll("#notifications-body .alert-entry")).toHaveLength(17);
    expect(dom.window.document.getElementById("notifications-load-more")).toBeNull();
    expect(dom.window.document.getElementById("notifications-body").textContent).toContain("17 alerte(s) au total");
  });
});

describe("app.js — renderAvisDuJour (synthèse quotidienne mise en avant + notification push)", () => {
  let dom;

  function avisItem(overrides = {}) {
    return { id: "avis-jour-2026-08-31", type: "avis_du_jour", ticker_ou_theme: "PORTEFEUILLE", triggered_at: "2026-08-31T06:00:00Z", message: "BTC et ETH restent en ATTENTE, rien de nouveau à signaler.", ...overrides };
  }

  beforeEach(() => {
    dom = loadPage(["config.js", "app.js"], { html: APP_FIXTURE_HTML });
  });

  it("renders nothing (not even an empty card) when no avis_du_jour entry exists yet", () => {
    dom.window.renderAvisDuJour([{ id: "a", type: "seuil_technique", message: "Autre chose", triggered_at: "2026-08-31T00:00:00Z" }]);
    expect(dom.window.document.getElementById("avis-du-jour").innerHTML).toBe("");
    dom.window.renderAvisDuJour(null);
    expect(dom.window.document.getElementById("avis-du-jour").innerHTML).toBe("");
  });

  it("shows the message of the most recent avis_du_jour entry when several exist (history, never overwritten)", () => {
    dom.window.renderAvisDuJour([
      avisItem({ id: "avis-jour-2026-08-30", triggered_at: "2026-08-30T06:00:00Z", message: "Message d'hier." }),
      avisItem({ id: "avis-jour-2026-08-31", triggered_at: "2026-08-31T06:00:00Z", message: "Message d'aujourd'hui." }),
    ]);
    const text = dom.window.document.getElementById("avis-du-jour").textContent;
    expect(text).toContain("Message d'aujourd'hui.");
    expect(text).not.toContain("Message d'hier.");
  });

  it("shows a sentiment badge when the routine provided one, matching the same badge used on regular alerts", () => {
    dom.window.renderAvisDuJour([avisItem({ sentiment: "positif" })]);
    expect(dom.window.document.getElementById("avis-du-jour").textContent).toContain("Bullish");
  });

  it("escapes the message before inserting it (trust boundary, same rule as regular alerts)", () => {
    dom.window.renderAvisDuJour([avisItem({ message: "<b>x</b>" })]);
    const el = dom.window.document.getElementById("avis-du-jour");
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toContain("<b>x</b>");
  });

  it("highlights a key figure in the message (highlightKeyInfo, not a bare escapeHtml)", () => {
    dom.window.renderAvisDuJour([avisItem({ message: "BTC a reculé de 8,2 % cette semaine." })]);
    expect(dom.window.document.querySelector(".avis-du-jour-text mark.hl-stat").textContent).toBe("8,2 %");
  });

  it("does not warn about staleness for a fresh avis (well under 30h old)", () => {
    dom.window.Date.now = () => new Date("2026-08-31T08:00:00Z").getTime(); // 2h apres triggered_at
    dom.window.renderAvisDuJour([avisItem({ triggered_at: "2026-08-31T06:00:00Z" })]);
    expect(dom.window.document.getElementById("avis-du-jour").textContent).not.toContain("plus d'un jour");
  });

  it("warns honestly when the latest avis is stale (well over 30h old) rather than presenting it as today's", () => {
    dom.window.Date.now = () => new Date("2026-09-02T12:00:00Z").getTime(); // >48h apres triggered_at
    dom.window.renderAvisDuJour([avisItem({ triggered_at: "2026-08-31T06:00:00Z" })]);
    expect(dom.window.document.getElementById("avis-du-jour").textContent).toContain("plus d'un jour");
  });
});

describe("app.js — couleur repère (verdict/type) et aperçu tronqué (renderClampableText)", () => {
  let dom;
  const LONG_TEXT = "Analyse détaillée du mouvement observé sur cet actif. ".repeat(6); // > 200 caractères

  function verdict(overrides = {}) {
    return {
      id: "v0", asset: "bitcoin", ticker: "BTC", verdict: "ACHAT", reasoning: "Raisonnement court",
      confidence_pct: 70, horizon_days: 7, status: "resolved", issued_at: "2026-08-01T00:00:00Z",
      ...overrides,
    };
  }
  function alertItem(overrides = {}) {
    return {
      id: "a0", type: "seuil_technique", ticker_ou_theme: "BTC", message: "Message court",
      triggered_at: "2026-08-01T00:00:00Z", ...overrides,
    };
  }

  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "cards.js", "detail.js", "insights.js", "app.js"], { html: APP_FIXTURE_HTML });
  });

  it("colors each journal entry by its verdict (achat/vente/attente)", () => {
    dom.window.renderJournal([verdict({ id: "a", verdict: "ACHAT" }), verdict({ id: "b", verdict: "VENTE" }), verdict({ id: "c", verdict: "ATTENTE" })]);
    const entries = dom.window.document.querySelectorAll("#journal-body .journal-entry");
    expect([...entries].some((e) => e.classList.contains("verdict-achat"))).toBe(true);
    expect([...entries].some((e) => e.classList.contains("verdict-vente"))).toBe(true);
    expect([...entries].some((e) => e.classList.contains("verdict-attente"))).toBe(true);
  });

  it("colors each alert entry by its type", () => {
    dom.window.renderNotifications([alertItem({ id: "a", type: "actualite_macro" })]);
    const entry = dom.window.document.querySelector("#notifications-body .alert-entry");
    expect(entry.classList.contains("type-actualite_macro")).toBe(true);
  });

  it("renders a short reasoning/message as a plain <p>, with no 'Lire plus' toggle", () => {
    dom.window.renderJournal([verdict({ reasoning: "Court" })]);
    expect(dom.window.document.querySelector("#journal-body .clamp-text")).toBeNull();
    expect(dom.window.document.querySelector("#journal-body [data-clamp-target]")).toBeNull();
  });

  it("clamps a long reasoning and reveals it via a 'Lire plus' toggle, without also opening the entry's own detail panel", () => {
    dom.window.renderJournal([verdict({ reasoning: LONG_TEXT })]);
    const entry = dom.window.document.querySelector("#journal-body .journal-entry");
    const clamped = entry.querySelector(".clamp-text");
    const toggle = entry.querySelector("[data-clamp-target]");
    expect(clamped).not.toBeNull();
    expect(toggle).not.toBeNull();

    toggle.click();
    expect(clamped.classList.contains("clamp-open")).toBe(true);
    expect(toggle.classList.contains("expanded")).toBe(true);
    // Le clic sur "Lire plus" ne doit pas aussi déclencher le clic de la carte englobante
    // (attachDetailToggle, voir detail.js) — sinon un seul clic ouvrirait deux choses à la fois.
    expect(entry.classList.contains("expanded")).toBe(false);

    toggle.click();
    expect(clamped.classList.contains("clamp-open")).toBe(false);
  });

  it("clamps a long alert message the same way", () => {
    dom.window.renderNotifications([alertItem({ message: LONG_TEXT })]);
    const entry = dom.window.document.querySelector("#notifications-body .alert-entry");
    expect(entry.querySelector(".clamp-text")).not.toBeNull();
    expect(entry.querySelector("[data-clamp-target]")).not.toBeNull();
  });
});

describe("app.js — renderMacroRegime", () => {
  let dom;

  beforeEach(() => {
    dom = loadPage(["config.js", "app.js"], { html: APP_FIXTURE_HTML });
  });

  it("shows the not-yet-classified empty state when there is no regime, without throwing on a null engineHistory", () => {
    dom.window.renderMacroRegime({});
    expect(dom.window.document.getElementById("macro-regime-banner").textContent).toContain("pas encore classifié");
    expect(() => dom.window.renderMacroRegime(null)).not.toThrow();
    expect(dom.window.document.getElementById("macro-regime-banner").textContent).toContain("pas encore classifié");
  });

  it.each([
    ["risk-on", "positive", "Appétit pour le risque"],
    ["risk-off", "negative", "Aversion au risque"],
    ["neutre", "", "Neutre"],
  ])("maps regime '%s' to CSS class '%s' and French label '%s'", (regime, cls, label) => {
    dom.window.renderMacroRegime({ macro_regime: { regime, fear_greed_value: 50, btc_dominance_pct: 55.4 } });
    const valueEl = dom.window.document.querySelector("#macro-regime-banner .hero-stat-value");
    expect(valueEl.textContent).toBe(label);
    expect(valueEl.className.trim()).toBe(`hero-stat-value ${cls}`.trim());
  });

  it("formats btc_dominance_pct to one decimal with a percent sign", () => {
    dom.window.renderMacroRegime({ macro_regime: { regime: "neutre", fear_greed_value: 50, btc_dominance_pct: 55.449 } });
    expect(dom.window.document.getElementById("macro-regime-banner").textContent).toContain("55.4 %");
  });

  it("shows an em dash for a missing btc_dominance_pct instead of crashing on .toFixed", () => {
    dom.window.renderMacroRegime({ macro_regime: { regime: "neutre", fear_greed_value: 50, btc_dominance_pct: null } });
    const values = dom.window.document.querySelectorAll("#macro-regime-banner .hero-stat-value");
    expect(values[2].textContent).toBe("—");
  });

  it("escapes the regime note before inserting it (trust boundary)", () => {
    dom.window.renderMacroRegime({ macro_regime: { regime: "neutre", fear_greed_value: 50, btc_dominance_pct: 50, note: "<b>x</b>" } });
    const el = dom.window.document.getElementById("macro-regime-banner");
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toContain("<b>x</b>");
  });

  it("highlights a key figure in the regime note (highlightKeyInfo, not a bare escapeHtml)", () => {
    dom.window.renderMacroRegime({ macro_regime: { regime: "neutre", fear_greed_value: 50, btc_dominance_pct: 50, note: "Dominance en hausse de 1,5 % sur la semaine." } });
    expect(dom.window.document.querySelector("#macro-regime-banner mark.hl-stat").textContent).toBe("1,5 %");
  });
});

describe("app.js — renderNews", () => {
  let dom;

  beforeEach(() => {
    dom = loadPage(["config.js", "app.js"], { html: APP_FIXTURE_HTML });
  });

  it("shows the empty state when there are no news items, without throwing when newsData itself is null", () => {
    dom.window.renderNews({ items: [] });
    expect(dom.window.document.getElementById("news-body").textContent).toContain("Aucune actualité");
    expect(() => dom.window.renderNews(null)).not.toThrow();
  });

  it("escapes the title before inserting it (trust boundary — news summaries are untrusted per CLAUDE.md)", () => {
    dom.window.renderNews({ items: [{ title: "<b>Titre</b>", url: "https://example.com/a", source: "Le Monde" }] });
    const el = dom.window.document.getElementById("news-body");
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toContain("<b>Titre</b>");
  });

  it("highlights a key figure in the headline (highlightKeyInfo, not a bare escapeHtml)", () => {
    dom.window.renderNews({ items: [{ title: "BTC bondit de 12 %", url: "https://example.com/a", source: "X" }] });
    expect(dom.window.document.querySelector("#news-body mark.hl-stat").textContent).toBe("12 %");
  });

  it("renders a real http(s) URL as a safe, new-tab link", () => {
    dom.window.renderNews({ items: [{ title: "Titre", url: "https://example.com/a", source: "Le Monde" }] });
    const link = dom.window.document.querySelector("#news-body a");
    expect(link.getAttribute("href")).toBe("https://example.com/a");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("never renders a javascript: URL as a link (safeUrl blocks it) — falls back to plain text", () => {
    dom.window.renderNews({ items: [{ title: "Titre", url: "javascript:alert(1)", source: "X" }] });
    const el = dom.window.document.getElementById("news-body");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toContain("Titre");
  });

  it("flags a headline containing a major-news keyword (token unlock) as 'à surveiller'", () => {
    dom.window.renderNews({ items: [{ title: "Hyperliquid Hits Record High as $1.2 Billion Token Unlock Looms", url: "https://example.com/a", source: "X" }] });
    const item = dom.window.document.querySelector("#news-body .news-item");
    expect(item.classList.contains("important")).toBe(true);
    expect(item.textContent).toContain("À surveiller");
  });

  it("does not flag an ordinary headline with no major-news keyword", () => {
    dom.window.renderNews({ items: [{ title: "Grayscale Sees Zcash as Potential Bitcoin Challenger", url: "https://example.com/a", source: "X" }] });
    const item = dom.window.document.querySelector("#news-body .news-item");
    expect(item.classList.contains("important")).toBe(false);
    expect(item.textContent).not.toContain("À surveiller");
  });
});

describe("app.js — isNewsImportant (repérage de mots-clés, jamais une lecture bullish/bearish)", () => {
  const dom = loadPage(["config.js", "app.js"], { html: APP_FIXTURE_HTML });
  const { isNewsImportant } = dom.window;

  it("matches on regulatory, security, macro/Fed and token-unlock keywords, case-insensitively", () => {
    expect(isNewsImportant("SEC Sues Major Exchange Over Unregistered Securities")).toBe(true);
    expect(isNewsImportant("Exchange Hacked, $40M Drained From Hot Wallet")).toBe(true);
    expect(isNewsImportant("Fed Signals Hawkish Pivot at FOMC Meeting")).toBe(true);
    expect(isNewsImportant("Project Announces $500M Token Unlock Next Week")).toBe(true);
    expect(isNewsImportant("bitcoin etf sees record inflow")).toBe(true); // insensible à la casse
  });

  it("does not flag routine headlines with no matching keyword", () => {
    expect(isNewsImportant("Analyst Shares Weekly Chart Update on Ethereum")).toBe(false);
  });

  it("handles a missing/empty title without throwing", () => {
    expect(isNewsImportant(undefined)).toBe(false);
    expect(isNewsImportant("")).toBe(false);
  });
});

describe("app.js — updateHeroStats", () => {
  let dom;

  beforeEach(() => {
    dom = loadPage(["config.js", "app.js"], { html: APP_FIXTURE_HTML });
  });

  it("sets the verdict and alert counts as plain text", () => {
    dom.window.updateHeroStats([{}, {}, {}], [{}, {}]);
    expect(dom.window.document.getElementById("hero-verdicts").textContent).toBe("3");
    expect(dom.window.document.getElementById("hero-alerts").textContent).toBe("2");
  });

  it("treats a missing/null alerts array as zero, without throwing", () => {
    expect(() => dom.window.updateHeroStats([], null)).not.toThrow();
    expect(dom.window.document.getElementById("hero-alerts").textContent).toBe("0");
  });
});

const ACCORDION_HTML = `<!doctype html><html><body>
  <div id="engine-accordion">
    <div class="engine-acc">
      <button class="engine-acc-summary" type="button" aria-expanded="true"></button>
      <div class="engine-acc-body open"></div>
    </div>
    <div class="engine-acc">
      <button class="engine-acc-summary" type="button" aria-expanded="false"></button>
      <div class="engine-acc-body"></div>
    </div>
    <div class="engine-acc">
      <button class="engine-acc-summary" type="button" aria-expanded="false"></button>
      <div class="engine-acc-body"></div>
    </div>
  </div>
</body></html>`;

describe("app.js — initExclusiveAccordion", () => {
  let dom, accs;

  beforeEach(() => {
    dom = loadPage(["app.js"], { html: ACCORDION_HTML });
    const container = dom.window.document.getElementById("engine-accordion");
    dom.window.initExclusiveAccordion(container);
    accs = Array.from(container.querySelectorAll(".engine-acc"));
  });

  it("does nothing and does not throw when given a null container", () => {
    expect(() => dom.window.initExclusiveAccordion(null)).not.toThrow();
  });

  it("opening a closed panel closes whichever other panel was open (exclusive)", () => {
    accs[1].querySelector(".engine-acc-summary").click();
    expect(accs[0].querySelector(".engine-acc-body").classList.contains("open")).toBe(false);
    expect(accs[0].querySelector(".engine-acc-summary").getAttribute("aria-expanded")).toBe("false");
    expect(accs[1].querySelector(".engine-acc-body").classList.contains("open")).toBe(true);
    expect(accs[1].querySelector(".engine-acc-summary").getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking the already-open panel's summary closes it, leaving every panel closed", () => {
    accs[0].querySelector(".engine-acc-summary").click();
    accs.forEach((a) => expect(a.querySelector(".engine-acc-body").classList.contains("open")).toBe(false));
    expect(accs[0].querySelector(".engine-acc-summary").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps exactly one panel open at a time across repeated clicks", () => {
    accs[1].querySelector(".engine-acc-summary").click();
    accs[2].querySelector(".engine-acc-summary").click();
    const openCount = accs.filter((a) => a.querySelector(".engine-acc-body").classList.contains("open")).length;
    expect(openCount).toBe(1);
    expect(accs[2].querySelector(".engine-acc-body").classList.contains("open")).toBe(true);
  });
});
