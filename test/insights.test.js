import { describe, it, expect } from "vitest";
import { loadPage, setGlobal } from "./helpers/loadPage.js";

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
