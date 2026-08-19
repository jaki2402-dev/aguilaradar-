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
  <nav class="tabs">
    <button data-tab="overview" class="active"><span class="tab-label">Accueil</span></button>
    <button data-tab="favoris"><span class="tab-label">Favoris</span></button>
    <button data-tab="opportunities"><span class="tab-label">Opportunités</span></button>
    <button data-tab="journal"><span class="tab-label">Journal</span></button>
    <button data-tab="engine"><span class="tab-label">Moteur</span></button>
    <button data-tab="notifications"><span class="tab-label">Alertes</span></button>
    <button data-tab="assistant"><span class="tab-label">Assistant</span></button>
  </nav>
  <section id="tab-overview" class="tab-panel active">
    <div id="macro-regime-banner"></div>
    <div class="hero-stat-value" id="hero-verdicts">0</div>
    <div class="hero-stat-value" id="hero-alerts">0</div>
    <div id="news-body"></div>
    <div id="accueil-highlights"></div>
  </section>
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
    expect(dom.window.document.querySelectorAll("#opportunities-body .opp-card")).toHaveLength(3);
  });

  it("mirrors only the top 3 (by confidence) into #accueil-highlights while the full list stays in #opportunities-body", () => {
    const items = [opp("AAA"), opp("BBB"), opp("CCC"), opp("DDD"), opp("EEE")];
    dom.window.renderOpportunities({ opportunities: items });
    expect(dom.window.document.querySelectorAll("#accueil-highlights .opp-card")).toHaveLength(3);
    expect(dom.window.document.querySelectorAll("#opportunities-body .opp-card")).toHaveLength(5);
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
