import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

function loadBreakdownPage() {
  return loadPage(["config.js", "portfolio.js", "allocation.js", "verdict-breakdown.js"]);
}

describe("verdict-breakdown.js — scoreMomentum", () => {
  const dom = loadBreakdownPage();
  const { computeVerdictBreakdown } = dom.window;

  it("returns null (Donnée insuffisante) without signal_consensus", () => {
    const b = computeVerdictBreakdown({ verdict: { verdict: "ACHAT", confidence_pct: 80 } });
    expect(b.momentum).toBeNull();
  });

  it("scores a strong bullish consensus with agreement highest", () => {
    const verdict = { verdict: "ACHAT", confidence_pct: 70, signal_consensus: { technique: "haussier", accord_count: 2 } };
    expect(computeVerdictBreakdown({ verdict }).momentum).toBe(9);
  });

  it("caps the bullish bonus at 10", () => {
    const verdict = { confidence_pct: 100, signal_consensus: { technique: "haussier", accord_count: 3 } };
    expect(computeVerdictBreakdown({ verdict }).momentum).toBeLessThanOrEqual(10);
  });

  it("scores a weak (low confidence) bullish consensus lower than a strong one", () => {
    const weak = { confidence_pct: 50, signal_consensus: { technique: "haussier", accord_count: 2 } };
    const strong = { confidence_pct: 70, signal_consensus: { technique: "haussier", accord_count: 2 } };
    const wb = computeVerdictBreakdown({ verdict: weak }).momentum;
    const sb = computeVerdictBreakdown({ verdict: strong }).momentum;
    expect(wb).toBeLessThan(sb);
  });

  it("scores a strong bearish consensus lowest", () => {
    const verdict = { confidence_pct: 80, signal_consensus: { technique: "baissier", accord_count: 2 } };
    expect(computeVerdictBreakdown({ verdict }).momentum).toBeLessThanOrEqual(2);
  });

  it("scores mixte/neutre as a middling 5", () => {
    const verdict = { confidence_pct: 50, signal_consensus: { technique: "mixte" } };
    expect(computeVerdictBreakdown({ verdict }).momentum).toBe(5);
  });
});

describe("verdict-breakdown.js — scoreFondamentaux", () => {
  const dom = loadBreakdownPage();
  const { computeVerdictBreakdown } = dom.window;

  it("returns null without a numeric conviction", () => {
    expect(computeVerdictBreakdown({ thesisEntry: { recommendation: "Renforcer" } }).fondamentaux).toBeNull();
    expect(computeVerdictBreakdown({ thesisEntry: null }).fondamentaux).toBeNull();
  });

  it("ranks Renforcer/high conviction above Conserver/low conviction", () => {
    const strong = computeVerdictBreakdown({ thesisEntry: { recommendation: "Renforcer", conviction: 9 } }).fondamentaux;
    const weak = computeVerdictBreakdown({ thesisEntry: { recommendation: "Conserver", conviction: 3 } }).fondamentaux;
    expect(strong).toBeGreaterThan(weak);
  });

  it("scores Réduire/high conviction lowest", () => {
    expect(computeVerdictBreakdown({ thesisEntry: { recommendation: "Réduire", conviction: 9 } }).fondamentaux).toBeLessThanOrEqual(1);
  });
});

describe("verdict-breakdown.js — scoreTokenomics", () => {
  it("is always null — no structured source exists yet (see docs/verdict-methodology.md)", () => {
    const dom = loadBreakdownPage();
    expect(dom.window.computeVerdictBreakdown({}).tokenomics).toBeNull();
    expect(dom.window.computeVerdictBreakdown({ verdict: {}, thesisEntry: {}, marketCapUsd: 1e9, tvlUsd: 1e6 }).tokenomics).toBeNull();
  });
});

describe("verdict-breakdown.js — scoreValorisation", () => {
  const dom = loadBreakdownPage();
  const { computeVerdictBreakdown } = dom.window;

  it("returns null without both marketCapUsd and tvlUsd", () => {
    expect(computeVerdictBreakdown({ marketCapUsd: 1e9 }).valorisation).toBeNull();
    expect(computeVerdictBreakdown({ tvlUsd: 1e6 }).valorisation).toBeNull();
  });

  it("returns null when tvlUsd is zero or negative (division safety)", () => {
    expect(computeVerdictBreakdown({ marketCapUsd: 1e9, tvlUsd: 0 }).valorisation).toBeNull();
  });

  it("computes the raw marketcap/TVL ratio, not an invented 0-10 tier", () => {
    const b = computeVerdictBreakdown({ marketCapUsd: 2e9, tvlUsd: 4e6 });
    expect(b.valorisation).toEqual({ ratio: 500 });
  });
});

describe("verdict-breakdown.js — scoreRisque", () => {
  const dom = loadBreakdownPage();
  const { computeVerdictBreakdown } = dom.window;

  it("is 'faible' with no verdict/thesis signals at all", () => {
    expect(computeVerdictBreakdown({}).risque).toBe("faible");
  });

  it("is never 'Donnée insuffisante' — absence of a bad signal is itself the information", () => {
    expect(computeVerdictBreakdown({}).risque).not.toBeNull();
  });

  it("is 'modéré' with exactly one warning signal (signal précoce défavorable)", () => {
    const verdict = { verdict: "ACHAT", signal_precoce: { threshold_crossed: true } };
    expect(computeVerdictBreakdown({ verdict }).risque).toBe("modéré");
  });

  it("is 'élevé' with both signal précoce AND a verdict/thesis conflict", () => {
    const verdict = { verdict: "ACHAT", signal_precoce: { threshold_crossed: true } };
    const thesisEntry = { recommendation: "Réduire" }; // ACHAT + réduire = conflit (VERDICT_THESIS_CONFLICTS)
    expect(computeVerdictBreakdown({ verdict, thesisEntry }).risque).toBe("élevé");
  });
});

describe("verdict-breakdown.js — no fabricated global score, ever", () => {
  it("computeVerdictBreakdown's result never contains a combined/global field", () => {
    const dom = loadBreakdownPage();
    const b = dom.window.computeVerdictBreakdown({
      verdict: { confidence_pct: 90, signal_consensus: { technique: "haussier", accord_count: 3 } },
      thesisEntry: { recommendation: "Renforcer", conviction: 10 },
      marketCapUsd: 1e9,
      tvlUsd: 1e6,
    });
    expect(Object.keys(b).sort()).toEqual(["fondamentaux", "momentum", "risque", "tokenomics", "valorisation"]);
  });
});

describe("verdict-breakdown.js — renderVerdictBreakdown", () => {
  const dom = loadBreakdownPage();
  const { renderVerdictBreakdown, computeVerdictBreakdown } = dom.window;

  it("shows 'Donnée insuffisante' for every category when nothing is available (momentum, fondamentaux, tokenomics, valorisation — pas risque, jamais insuffisant)", () => {
    const html = renderVerdictBreakdown(computeVerdictBreakdown({}));
    expect((html.match(/Donnée insuffisante/g) || []).length).toBe(4);
  });

  it("renders Tokenomics as 'Donnée insuffisante' too even though its score is always null", () => {
    const html = renderVerdictBreakdown(computeVerdictBreakdown({}));
    const tokenomicsRow = html.split("Tokenomics")[1].split("</div>")[0];
    expect(tokenomicsRow).toContain("Donnée insuffisante");
  });

  it("renders exactly the 5 category rows and nothing else numeric (no combined/global score slipped in)", () => {
    const html = renderVerdictBreakdown(
      computeVerdictBreakdown({
        verdict: { confidence_pct: 90, signal_consensus: { technique: "haussier", accord_count: 3 } },
        thesisEntry: { recommendation: "Renforcer", conviction: 10 },
      })
    );
    expect((html.match(/verdict-cat-row/g) || []).length).toBe(5); // 5 ouvertures de <div class="verdict-cat-row">, jamais une 6e ligne "score total"
    expect(html).not.toMatch(/score total|note globale unique|\/100\b/i);
  });

  it("renders the risk label in clear text, not the internal slug", () => {
    const html = renderVerdictBreakdown(computeVerdictBreakdown({}));
    expect(html).toContain("Faible");
    expect(html).not.toContain(">faible<");
  });

  it("formats the valorisation ratio with a × sign, not a 0-10 score", () => {
    const html = renderVerdictBreakdown(computeVerdictBreakdown({ marketCapUsd: 2e9, tvlUsd: 4e6 }));
    expect(html).toContain("500.0×");
  });
});
