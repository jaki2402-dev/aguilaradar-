import { describe, it, expect, beforeEach } from "vitest";
import { loadPage, setGlobal } from "./helpers/loadPage.js";

function verdict(overrides) {
  return { asset: "bitcoin", verdict: "ACHAT", confidence_pct: 70, issued_at: "2026-09-01T00:00:00Z", ...overrides };
}
function thesis(overrides) {
  return { recommendation: "Renforcer", conviction: 8, constat: "test", ...overrides };
}
function pos(overrides) {
  return { cgId: "bitcoin", ticker: "BTC", name: "Bitcoin", pending: false, value: 100, ...overrides };
}

describe("allocation.js — computePositionAttractiveness", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "portfolio.js", "allocation.js"]);
  });

  function compute(v, t, favCtx, valueShare) {
    return dom.window.computePositionAttractiveness(pos(), v, t, favCtx, valueShare);
  }

  it("agreeing strong ACHAT verdict + high-conviction Renforcer thesis -> Très attractive, confiance élevée", () => {
    const r = compute(verdict(), thesis(), null, 10);
    expect(r.tier).toBe("Très attractive");
    expect(r.confidenceLevel).toBe("élevé");
    expect(r.reasons.some((x) => x.includes("ACHAT"))).toBe(true);
    expect(r.reasons.some((x) => x.includes("Renforcer"))).toBe(true);
  });

  it("agreeing strong VENTE verdict + high-conviction Réduire thesis -> À éviter actuellement", () => {
    const r = compute(verdict({ verdict: "VENTE", confidence_pct: 80 }), thesis({ recommendation: "Réduire", conviction: 9 }), null, 10);
    expect(r.tier).toBe("À éviter actuellement");
  });

  it("never invents a verdict or thesis that doesn't exist — missing data is flagged, not guessed", () => {
    const r = compute(null, null, null, 0);
    expect(r.tier).toBe("Donnée insuffisante");
    expect(r.confidenceLevel).toBe("faible");
    expect(r.missingData).toContain("Verdict technique du moteur");
    expect(r.missingData).toContain("Thèse fondamentale hebdo");
    expect(r.reasons).toHaveLength(0);
  });

  it("flags a genuine verdict/thèse conflict (ACHAT + Réduire) as a caveat, never silently averaged away", () => {
    const r = compute(verdict({ verdict: "ACHAT", confidence_pct: 70 }), thesis({ recommendation: "Réduire", conviction: 8 }), null, 5);
    expect(r.caveats.some((c) => c.toLowerCase().includes("opposées"))).toBe(true);
    expect(r.confidenceLevel).not.toBe("élevé");
  });

  it("surfaces a signal précoce already contradicting the active verdict", () => {
    const v = verdict({ signal_precoce: { threshold_crossed: true, note: "test note" } });
    const r = compute(v, thesis(), null, 5);
    expect(r.caveats.some((c) => c.includes("Signal précoce"))).toBe(true);
  });

  it("never folds already-held concentration into the attractiveness score, only annotates it", () => {
    const low = compute(verdict(), thesis(), null, 5);
    const high = compute(verdict(), thesis(), null, 35);
    expect(high.points).toBe(low.points); // même signaux -> même score, la concentration ne change JAMAIS le score
    expect(high.caveats.some((c) => c.includes("35 %"))).toBe(true);
    expect(low.caveats.some((c) => c.includes("%"))).toBe(false);
  });

  it("flags a brand-new (0%) position as an opening rather than a top-up", () => {
    const r = compute(verdict(), thesis(), null, 0);
    expect(r.caveats.some((c) => c.includes("nouvelle ouverture"))).toBe(true);
  });

  it("surfaces real onchain/open-interest data when present, flags it missing when absent (never estimated)", () => {
    const withData = compute(verdict(), thesis(), { onchain_signal: { available: true, note: "whales accumulent" }, open_interest: { value_usd: 25000000000, source: "CoinGlass" } }, 5);
    expect(withData.caveats.some((c) => c.includes("whales accumulent"))).toBe(true);
    expect(withData.reasons.some((r) => r.includes("25000 M$") || r.includes("M$"))).toBe(true);
    expect(withData.missingData).not.toContain("Open interest / positionnement dérivés");

    const noData = compute(verdict(), thesis(), { onchain_signal: { available: false }, open_interest: { value_usd: null } }, 5);
    expect(noData.missingData).toContain("Flux whales / on-chain récents");
    expect(noData.missingData).toContain("Open interest / positionnement dérivés");
  });

  it("never claims false precision: unavailable ETF-flow/unlock-calendar data is always listed as missing", () => {
    const r = compute(verdict(), thesis(), null, 5);
    expect(r.missingData.some((m) => m.includes("ETF"))).toBe(true);
    expect(r.missingData.some((m) => m.includes("unlocks"))).toBe(true);
  });
});

describe("allocation.js — contextualizeAlert (alertes contextuelles, section 16B)", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "portfolio.js", "allocation.js"]);
  });

  function alert(overrides) {
    return { type: "seuil_technique", ticker_ou_theme: "BTC", sentiment: "négatif", ...overrides };
  }

  it("flags a price drop as NOT confirming fundamental deterioration when the weekly thesis is still bullish", () => {
    setGlobal(dom, "latestPortfolioThesis", { positions: { bitcoin: { recommendation: "Renforcer", conviction: 8 } } });
    const note = dom.window.contextualizeAlert(alert({ sentiment: "négatif" }));
    expect(note).toContain("aucune détérioration fondamentale majeure");
    expect(note).toContain("Renforcer");
    expect(note).toContain("8/10");
  });

  it("flags a price rise as NOT confirmed by fundamentals when the weekly thesis says Réduire", () => {
    setGlobal(dom, "latestPortfolioThesis", { positions: { bitcoin: { recommendation: "Réduire", conviction: 6 } } });
    const note = dom.window.contextualizeAlert(alert({ sentiment: "positif" }));
    expect(note).toContain("n'est pour l'instant pas confirmée");
  });

  it("says nothing when price direction and thesis already agree — never manufactures a divergence", () => {
    setGlobal(dom, "latestPortfolioThesis", { positions: { bitcoin: { recommendation: "Renforcer", conviction: 8 } } });
    expect(dom.window.contextualizeAlert(alert({ sentiment: "positif" }))).toBeNull();
  });

  it("says nothing for a neutral (\"Attendre\") thesis — never invents a direction it doesn't have", () => {
    setGlobal(dom, "latestPortfolioThesis", { positions: { bitcoin: { recommendation: "Attendre", conviction: 4 } } });
    expect(dom.window.contextualizeAlert(alert({ sentiment: "négatif" }))).toBeNull();
    expect(dom.window.contextualizeAlert(alert({ sentiment: "positif" }))).toBeNull();
  });

  it("says nothing when no thesis exists yet for this asset — never guesses one", () => {
    setGlobal(dom, "latestPortfolioThesis", { positions: {} });
    expect(dom.window.contextualizeAlert(alert())).toBeNull();
  });

  it("only applies to seuil_technique alerts on a tracked favori — a macro/theme alert is left alone", () => {
    setGlobal(dom, "latestPortfolioThesis", { positions: { bitcoin: { recommendation: "Renforcer", conviction: 8 } } });
    expect(dom.window.contextualizeAlert(alert({ type: "actualite_macro" }))).toBeNull();
    expect(dom.window.contextualizeAlert(alert({ ticker_ou_theme: "Régulation UE" }))).toBeNull();
  });
});

describe("allocation.js — rankPortfolioAttractiveness", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "portfolio.js", "allocation.js"]);
  });

  it("sorts by attractiveness descending and computes real portfolio value-share, never a fake one", () => {
    const positions = [
      pos({ cgId: "bitcoin", ticker: "BTC", value: 300 }),
      pos({ cgId: "ethereum", ticker: "ETH", value: 700 }),
    ];
    const verdicts = [verdict({ asset: "bitcoin", verdict: "ATTENTE", confidence_pct: 50 }), verdict({ asset: "ethereum", verdict: "ACHAT", confidence_pct: 80 })];
    const thesisData = { positions: { bitcoin: thesis({ recommendation: "Attendre", conviction: 5 }), ethereum: thesis({ recommendation: "Renforcer", conviction: 9 }) } };
    const ranked = dom.window.rankPortfolioAttractiveness(positions, verdicts, thesisData, null);
    expect(ranked[0].ticker).toBe("ETH");
    expect(ranked[1].ticker).toBe("BTC");
    expect(ranked.find((r) => r.ticker === "BTC").valueShare).toBeCloseTo(30, 5);
    expect(ranked.find((r) => r.ticker === "ETH").valueShare).toBeCloseTo(70, 5);
  });

  it("marks near-tied positions as a close call instead of implying a firm hierarchy", () => {
    const positions = [pos({ cgId: "bitcoin", ticker: "BTC", value: 500 }), pos({ cgId: "ethereum", ticker: "ETH", value: 500 })];
    const verdicts = [verdict({ asset: "bitcoin", verdict: "ACHAT", confidence_pct: 70 }), verdict({ asset: "ethereum", verdict: "ACHAT", confidence_pct: 70 })];
    const thesisData = { positions: { bitcoin: thesis({ recommendation: "Renforcer", conviction: 8 }), ethereum: thesis({ recommendation: "Renforcer", conviction: 8 }) } };
    const ranked = dom.window.rankPortfolioAttractiveness(positions, verdicts, thesisData, null);
    expect(ranked[0].closeCallWith).toBe(ranked[1].ticker);
  });

  it("formatAttractivenessForAiContext never fabricates a single numeric score in the text handed to the AI relay", () => {
    const positions = [pos({ cgId: "bitcoin", ticker: "BTC", value: 100 })];
    const verdicts = [verdict()];
    const thesisData = { positions: { bitcoin: thesis() } };
    const ranked = dom.window.rankPortfolioAttractiveness(positions, verdicts, thesisData, null);
    const text = dom.window.formatAttractivenessForAiContext(ranked);
    expect(text).toContain("BTC");
    expect(text).toContain("Très attractive");
    expect(text).not.toMatch(/\d+\/100/);
  });
});
