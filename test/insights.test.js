import { describe, it, expect } from "vitest";
import { loadPage, setGlobal, runScript } from "./helpers/loadPage.js";

describe("insights.js — computeProvisionalStanding", () => {
  function pageWithPrice(prices) {
    const dom = loadPage(["config.js", "prices.js", "insights.js"]);
    // latestFavorisPrices est un `let` de prices.js, lu par cette fonction — voir la note
    // dans loadPage.js sur pourquoi ça passe par setGlobal plutôt que dom.window.xxx =.
    setGlobal(dom, "latestFavorisPrices", prices);
    return dom;
  }

  it("is on track for an ACHAT verdict when the price has moved up, and caps progress at 100%", () => {
    const dom = pageWithPrice({ bitcoin: { eur: 60000 } });
    const standing = dom.window.computeProvisionalStanding({ asset: "bitcoin", verdict: "ACHAT", price_at_issue: 55000, threshold_pct: 5 });
    expect(standing.onTrack).toBe(true);
    expect(standing.interimMovePct).toBeCloseTo(9.0909, 3);
    expect(standing.progressPct).toBe(100); // (9.09/5)*100 > 100, plafonné
  });

  it("is on track for a VENTE verdict when the price has moved down", () => {
    const dom = pageWithPrice({ bitcoin: { eur: 60000 } });
    const standing = dom.window.computeProvisionalStanding({ asset: "bitcoin", verdict: "VENTE", price_at_issue: 65000, threshold_pct: 5 });
    expect(standing.onTrack).toBe(true);
    expect(standing.interimMovePct).toBeLessThan(0);
  });

  it("is on track for an ATTENTE verdict only while the move stays within the threshold band, with unclamped progress below 100%", () => {
    const dom = pageWithPrice({ bitcoin: { eur: 60000 } });
    const standing = dom.window.computeProvisionalStanding({ asset: "bitcoin", verdict: "ATTENTE", price_at_issue: 59000, threshold_pct: 5 });
    expect(standing.onTrack).toBe(true);
    expect(standing.progressPct).toBeLessThan(100);
    expect(standing.progressPct).toBeGreaterThan(0);
  });

  it("returns null when there is no live price yet for that asset", () => {
    const dom = pageWithPrice({});
    expect(dom.window.computeProvisionalStanding({ asset: "unknown-coin", verdict: "ACHAT", price_at_issue: 1 })).toBeNull();
  });
});

describe("insights.js — renderWeeklyDigest (fenêtre glissante de 7 jours)", () => {
  it("includes items from exactly 7 days ago (inclusive) and excludes anything older", () => {
    const dom = loadPage(["insights.js"], { html: `<!doctype html><html><body><div id="weekly-digest"></div></body></html>` });
    dom.window.Date.now = () => new Date("2026-08-17T12:00:00Z").getTime();

    const verdicts = [
      { issued_at: "2026-08-10T13:00:00Z" }, // 1h a l'interieur de la fenetre
      { issued_at: "2026-08-10T11:00:00Z" }, // 1h a l'exterieur -> exclu
      { issued_at: "2026-08-10T12:00:00Z", outcome: { resolved_at: "2026-08-12T00:00:00Z", verdict_correct: true } }, // exactement 7j -> inclus (>=)
    ];
    const opportunities = { opportunities: [{ flagged_at: "2026-08-16T00:00:00Z" }, { flagged_at: "2026-07-01T00:00:00Z" }] };
    const alerts = [{ triggered_at: "2026-08-15T00:00:00Z" }, { triggered_at: "2026-08-16T00:00:00Z" }];

    dom.window.renderWeeklyDigest(verdicts, opportunities, alerts);
    const html = dom.window.document.getElementById("weekly-digest").innerHTML;

    expect(html).toContain("Verdicts émis (7j)</div><div class=\"stat-value\">2<");
    expect(html).toContain("Vérifiés (7j)</div><div class=\"stat-value\">1 (1 juste)<");
    expect(html).toContain("Opportunités (7j)</div><div class=\"stat-value\">1<");
    expect(html).toContain("Alertes (7j)</div><div class=\"stat-value\">2<");
  });
});

describe("insights.js — renderMarketContext (contexte macro : stablecoins/emploi/ETF/or/Fed)", () => {
  function pageWithContext() {
    return loadPage(["config.js", "prices.js", "cards.js", "insights.js"], { html: `<!doctype html><html><body><div id="market-context-body"></div></body></html>` });
  }

  it("affiche les valeurs réelles (stablecoins/emploi/ETF/or/Fed) quand tous les champs sont renseignés", () => {
    const dom = pageWithContext();
    dom.window.renderMarketContext({
      last_computed_at: "2026-08-31T00:38:00Z",
      stablecoins: { dominance_pct: 11.11, note: "Note stablecoins." },
      employment_us: { unemployment_rate_pct: 4.1, market_reaction_note: "Note emploi." },
      etf_flows: { btc_etf_net_flow_usd: -201900000, note: "Note ETF." },
      gold: { spot_usd_per_oz: 2415.3, note: "Note or." },
      fed_policy: { funds_rate_range: "4.25%-4.50%", treasury_yield_10y_pct: 4.28, note: "Note Fed." },
    });
    const html = dom.window.document.getElementById("market-context-body").innerHTML;
    expect(html).toContain("11.1 %"); // dominance stablecoins
    expect(html).toContain("4.1 %"); // chômage
    expect(html).toMatch(/\$2\s*415/); // or, arrondi (espace insécable via toLocaleString)
    expect(html).toContain("4.25%-4.50%"); // taux Fed cible
    expect(html).toContain("4.28 %"); // rendement Trésor 10 ans
    expect(html).toContain("Note or.");
    expect(html).toContain("Note Fed.");
  });

  it("affiche des tirets pour l'or et la Fed tant que la routine ne les a pas encore renseignés, sans casser le reste déjà présent", () => {
    const dom = pageWithContext();
    dom.window.renderMarketContext({
      last_computed_at: "2026-08-31T00:38:00Z",
      stablecoins: { dominance_pct: 11.11 },
      employment_us: { unemployment_rate_pct: 4.1 },
      etf_flows: { btc_etf_net_flow_usd: -201900000 },
      // gold / fed_policy absents : jamais un chiffre inventé pour combler.
    });
    const html = dom.window.document.getElementById("market-context-body").innerHTML;
    expect(html).toContain("11.1 %");
    // Le label porte désormais une bulle d'aide glossaire (info-tip) avant la fermeture du
    // </div> — on vérifie label et valeur séparément plutôt qu'une sous-chaîne contiguë.
    expect(html).toContain("Or (once, USD)");
    expect(html).toContain("Taux Fed (cible)");
    expect(html).toContain("Trésor US 10 ans");
    expect(html.match(/stat-value">—</g).length).toBe(3);
  });

  it("highlights a key figure inside a market-context note (highlightKeyInfo, not a bare escapeHtml)", () => {
    const dom = pageWithContext();
    dom.window.renderMarketContext({
      last_computed_at: "2026-08-31T00:38:00Z",
      stablecoins: { dominance_pct: 11.11, note: "Dominance en repli de 2,3 % ce mois-ci." },
    });
    expect(dom.window.document.querySelector("#market-context-body mark.hl-stat").textContent).toBe("2,3 %");
  });
});

describe("insights.js — renderSectorBreakdown (seuil de concentration partagé, THRESHOLDS.concentrationWarningPct)", () => {
  function pageWithBreakdown() {
    return loadPage(["config.js", "insights.js"], { html: `<!doctype html><html><body><div id="sector-breakdown"></div></body></html>` });
  }

  it("ne déclenche pas d'avertissement au seuil par défaut (30%) sur la répartition réelle des 15 favoris", () => {
    const dom = pageWithBreakdown();
    dom.window.renderSectorBreakdown([]);
    const html = dom.window.document.getElementById("sector-breakdown").innerHTML;
    expect(html).toContain("raisonnablement diversifiée");
  });

  it("déclenche l'avertissement dès que la concentration réelle dépasse THRESHOLDS.concentrationWarningPct, jamais un seuil recodé en dur ici", () => {
    const dom = pageWithBreakdown();
    // Mutation en place (pas de réaffectation : THRESHOLDS est un const) pour abaisser le seuil
    // sous la concentration max réelle des 15 favoris et vérifier que le rendu suit bien la
    // valeur vivante de THRESHOLDS plutôt qu'un "30" ou "0.3" figé dans la fonction.
    runScript(dom, "THRESHOLDS.concentrationWarningPct = 1;", "lower threshold");
    dom.window.renderSectorBreakdown([]);
    const html = dom.window.document.getElementById("sector-breakdown").innerHTML;
    expect(html).toContain("Concentration notable");
    expect(html).toContain("plus de 1%");
  });
});

describe("insights.js — initDayReplay (régression 3caff5e : accumulation d'écouteurs)", () => {
  it("only ever fires the render exactly once per change, no matter how many times initDayReplay was called before (e.g. across refreshes)", () => {
    const dom = loadPage(["insights.js"], {
      html: `<!doctype html><html><body><input id="replay-date"><div id="replay-result"></div></body></html>`,
    });

    // Simule 3 rafraichissements successifs (loadAllData rappelle initDayReplay a chaque fois
    // sans jamais retirer l'ecouteur precedent, avant le correctif).
    dom.window.initDayReplay({ verdicts: [] });
    dom.window.initDayReplay({ verdicts: [] });
    dom.window.initDayReplay({ verdicts: [] });

    let calls = 0;
    const original = dom.window.renderDayReplay;
    dom.window.renderDayReplay = (...args) => {
      calls++;
      return original(...args);
    };

    const input = dom.window.document.getElementById("replay-date");
    input.value = "2026-08-10";
    input.dispatchEvent(new dom.window.Event("change"));

    expect(calls).toBe(1); // avant le correctif : 3
  });
});
