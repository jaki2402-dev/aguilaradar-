import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

// Fixture de 5 verdicts résolus, vérifiée à la main ET recoupée avec la vraie fonction
// avant d'écrire ces assertions (voir la session de travail) :
//   prédit ACHAT / réel ACHAT   -> correct
//   prédit ACHAT / réel ATTENTE -> faux
//   prédit VENTE / réel VENTE   -> correct
//   prédit ATTENTE / réel ATTENTE -> correct
//   prédit ATTENTE / réel ACHAT -> faux
function fiveVerdictFixture() {
  return [
    { verdict: "ACHAT", outcome: { actual_direction: "ACHAT" } },
    { verdict: "ACHAT", outcome: { actual_direction: "ATTENTE" } },
    { verdict: "VENTE", outcome: { actual_direction: "VENTE" } },
    { verdict: "ATTENTE", outcome: { actual_direction: "ATTENTE" } },
    { verdict: "ATTENTE", outcome: { actual_direction: "ACHAT" } },
  ];
}

describe("engine.js — classifyActualMove", () => {
  const dom = loadPage(["engine.js"]);
  const { classifyActualMove } = dom.window;

  it("returns null for a missing move", () => {
    expect(classifyActualMove(null, 5)).toBeNull();
    expect(classifyActualMove(undefined, 5)).toBeNull();
  });

  it("classifies a move strictly above the threshold as ACHAT", () => {
    expect(classifyActualMove(10, 5)).toBe("ACHAT");
  });

  it("classifies a move strictly below minus the threshold as VENTE", () => {
    expect(classifyActualMove(-10, 5)).toBe("VENTE");
  });

  it("classifies a move within the band, including exactly at the threshold, as ATTENTE", () => {
    expect(classifyActualMove(2, 5)).toBe("ATTENTE");
    expect(classifyActualMove(5, 5)).toBe("ATTENTE"); // pas ">" strict : la borne elle-même ne bascule pas
    expect(classifyActualMove(-5, 5)).toBe("ATTENTE");
  });
});

describe("engine.js — computeConfusionMatrix / computeClassMetrics / computeEngineStats", () => {
  const dom = loadPage(["engine.js"]);
  const { computeConfusionMatrix, computeClassMetrics, computeEngineStats } = dom.window;

  it("returns null on an empty resolved list", () => {
    expect(computeEngineStats([])).toBeNull();
  });

  it("builds the confusion matrix by hand-counted predicted x actual pairs", () => {
    expect(computeConfusionMatrix(fiveVerdictFixture())).toEqual({
      ACHAT: { ACHAT: 1, ATTENTE: 1, VENTE: 0 },
      ATTENTE: { ACHAT: 1, ATTENTE: 1, VENTE: 0 },
      VENTE: { ACHAT: 0, ATTENTE: 0, VENTE: 1 },
    });
  });

  it("ignores rows/columns for a verdict or outcome outside the known classes (defensive against bad data)", () => {
    const withJunk = fiveVerdictFixture().concat([{ verdict: "BOF", outcome: { actual_direction: "ACHAT" } }]);
    // Meme matrice qu'avant : la ligne "BOF" n'existe pas dans CLASSES, donc ignorée plutôt
    // que de planter ou de créer une clé parasite.
    expect(computeConfusionMatrix(withJunk)).toEqual(computeConfusionMatrix(fiveVerdictFixture()));
  });

  it("derives precision/recall/F1 per class from the matrix", () => {
    const matrix = computeConfusionMatrix(fiveVerdictFixture());
    const metrics = computeClassMetrics(matrix);
    expect(metrics.ACHAT).toEqual({ precision: 0.5, recall: 0.5, f1: 0.5, predictedTotal: 2, actualTotal: 2 });
    expect(metrics.ATTENTE).toEqual({ precision: 0.5, recall: 0.5, f1: 0.5, predictedTotal: 2, actualTotal: 2 });
    expect(metrics.VENTE).toEqual({ precision: 1, recall: 1, f1: 1, predictedTotal: 1, actualTotal: 1 });
  });

  it("computes overall accuracy/coverage/baseline/F1-macro (cross-checked against the real function, not just re-derived by hand)", () => {
    const stats = computeEngineStats(fiveVerdictFixture());
    expect(stats.total).toBe(5);
    expect(stats.correct).toBe(3);
    expect(stats.accuracyPct).toBe(60);
    expect(stats.coveragePct).toBe(60); // 3 verdicts non-ATTENTE sur 5
    expect(stats.baselineMajorityPct).toBe(40); // classe réelle majoritaire = 2/5
    expect(stats.f1Macro).toBeCloseTo((2 / 3) * 100, 10);
  });

  it("gives a class with zero predictions a null precision, and a class never observed a null recall", () => {
    const matrix = computeConfusionMatrix([{ verdict: "ACHAT", outcome: { actual_direction: "ACHAT" } }]);
    const metrics = computeClassMetrics(matrix);
    expect(metrics.VENTE.precision).toBeNull(); // jamais prédit
    expect(metrics.VENTE.recall).toBeNull(); // jamais observé en réalité
    expect(metrics.VENTE.f1).toBeNull();
  });
});

describe("engine.js — computeCalibrationBuckets", () => {
  const dom = loadPage(["engine.js"]);
  const { computeCalibrationBuckets } = dom.window;

  it("assigns verdicts to [min, max) buckets by confidence_pct and drops empty buckets", () => {
    const verdicts = [
      { confidence_pct: 45, outcome: { verdict_correct: true } },
      { confidence_pct: 49, outcome: { verdict_correct: false } },
      { confidence_pct: 50, outcome: { verdict_correct: true } }, // borne basse du bucket suivant
      { confidence_pct: 95, outcome: { verdict_correct: true } },
    ];
    expect(computeCalibrationBuckets(verdicts)).toEqual([
      { label: "40-50 %", count: 2, correct: 1, accuracyPct: 50 },
      { label: "50-60 %", count: 1, correct: 1, accuracyPct: 100 },
      { label: "80-100 %", count: 1, correct: 1, accuracyPct: 100 },
    ]);
  });

  it("returns an empty array when nothing is resolved yet", () => {
    expect(computeCalibrationBuckets([])).toEqual([]);
  });
});

describe("engine.js — computeAccuracyByRegime", () => {
  const dom = loadPage(["engine.js"]);
  const { computeAccuracyByRegime } = dom.window;

  it("groups by regime_at_issue and separately counts verdicts issued before regime tracking existed", () => {
    const verdicts = [
      { regime_at_issue: "risk-on", outcome: { verdict_correct: true } },
      { regime_at_issue: "risk-on", outcome: { verdict_correct: false } },
      { regime_at_issue: "risk-off", outcome: { verdict_correct: true } },
      { outcome: { verdict_correct: true } }, // pas de regime_at_issue (verdict pre-11/08)
    ];
    expect(computeAccuracyByRegime(verdicts)).toEqual({
      rows: [
        { regime: "risk-on", count: 2, correct: 1, accuracyPct: 50 },
        { regime: "risk-off", count: 1, correct: 1, accuracyPct: 100 },
      ],
      withoutRegime: 1,
    });
  });
});

describe("engine.js — computeOpportunitiesStats (régression 7409c45)", () => {
  const dom = loadPage(["engine.js"]);
  const { computeOpportunitiesStats } = dom.window;

  it("returns null when every opportunity's j14 horizon is still pending — the exact real-world scenario that shipped broken", () => {
    // Avant le correctif 7409c45, cette fonction lisait encore o.status/o.outcome à la
    // racine (schéma pré-migration multi-horizons) et affichait des stats inventées même
    // avec 8 opportunités toutes en attente. Ce test fige le bon comportement.
    const allPending = Array.from({ length: 8 }, (_, i) => ({
      id: `opp-${i}`,
      horizons: { j14: { status: "pending" } },
    }));
    expect(computeOpportunitiesStats(allPending)).toBeNull();
  });

  it("ignores opportunities without any horizons field at all (pre-migration shape) instead of crashing", () => {
    expect(computeOpportunitiesStats([{ id: "old-shape" }])).toBeNull();
  });

  it("only counts resolved j14 horizons, and excludes null move_pct from the average without excluding it from validatedPct", () => {
    const opportunities = [
      { horizons: { j14: { status: "resolved", outcome: { validated: true, move_pct: 12 } } } },
      { horizons: { j14: { status: "resolved", outcome: { validated: false, move_pct: -3 } } } },
      { horizons: { j14: { status: "resolved", outcome: { validated: true, move_pct: null } } } },
      { horizons: { j14: { status: "pending" } } },
      {},
    ];
    const stats = computeOpportunitiesStats(opportunities);
    expect(stats.total).toBe(3);
    expect(stats.validatedPct).toBeCloseTo((2 / 3) * 100, 10);
    expect(stats.avgMovePct).toBe(4.5); // (12 + -3) / 2, le null est exclu de la moyenne
  });
});

describe("engine.js — renderEngineTab / renderEnginePin (régression 062374d : alarme prématurée)", () => {
  const CONTAINER_HTML = `<!doctype html><html><body>
    <div id="engine-pin"></div>
    <div id="engine-summary"></div>
    <div id="engine-matrix"></div>
    <div id="engine-classes"></div>
    <div id="engine-log"></div>
    <div id="engine-calibration"></div>
    <div id="engine-regime-accuracy"></div>
    <div id="engine-opportunities"></div>
    <div id="engine-paper-portfolio"></div>
    <div id="engine-control-group"></div>
  </body></html>`;

  it("with a single resolved (and wrong) verdict, shows raw numbers but withholds the global judgment — never a computed -100/+100 pt edge", () => {
    // Reproduit le cas réel : 1 verdict résolu sur 16, faux (CTSI) -> exactitude 0%,
    // baseline 100% (classe majoritaire = la seule observée) -> écart brut de -100 points,
    // qui ne doit PLUS jamais s'afficher tel quel comme un "verdict du moteur sur lui-même".
    const dom = loadPage(["config.js", "engine.js"], { html: CONTAINER_HTML });
    const verdicts = [
      { status: "resolved", verdict: "VENTE", outcome: { actual_direction: "ACHAT" } },
      ...Array.from({ length: 15 }, () => ({ status: "pending", verdict: "ATTENTE" })),
    ];
    dom.window.renderEngineTab(verdicts, {}, null, null);

    const pinHtml = dom.window.document.getElementById("engine-pin").innerHTML;
    const matrixHtml = dom.window.document.getElementById("engine-matrix").innerHTML;

    expect(pinHtml).toContain("(min. 10)");
    expect(pinHtml).not.toMatch(/[-+]\d+\s*pts/);
    expect(matrixHtml).toContain("trop peu de verdicts vérifiés");
    // Le message de garde CITE lui-même ces expressions entre guillemets pour dire
    // qu'elles ne s'affichent pas ("... aucun jugement global (\"bat la référence\"...)
    // n'est fiable avant ce seuil") — on vérifie donc l'absence de la vraie phrase de
    // verdict ("Le moteur bat..."/"Le moteur fait..."), pas du fragment cité.
    expect(matrixHtml).not.toContain("Le moteur bat");
    expect(matrixHtml).not.toContain("Le moteur ne fait pas mieux");
    expect(matrixHtml).not.toContain("Le moteur fait actuellement moins bien");
  });

  it("once 10 resolved verdicts are reached, the gate opens and a real judgment + numeric edge appear", () => {
    const dom = loadPage(["config.js", "engine.js"], { html: CONTAINER_HTML });
    const verdicts = [
      ...Array.from({ length: 4 }, () => ({ status: "resolved", verdict: "ACHAT", outcome: { actual_direction: "ACHAT" } })),
      ...Array.from({ length: 3 }, () => ({ status: "resolved", verdict: "VENTE", outcome: { actual_direction: "VENTE" } })),
      ...Array.from({ length: 2 }, () => ({ status: "resolved", verdict: "ATTENTE", outcome: { actual_direction: "ATTENTE" } })),
      { status: "resolved", verdict: "ACHAT", outcome: { actual_direction: "VENTE" } },
    ];
    dom.window.renderEngineTab(verdicts, {}, null, null);

    const pinHtml = dom.window.document.getElementById("engine-pin").innerHTML;
    const matrixHtml = dom.window.document.getElementById("engine-matrix").innerHTML;

    // 9/10 corrects, baseline classe majoritaire 40% (ACHAT et VENTE a 4 chacun) -> ecart +50.
    expect(pinHtml).toContain("+50 pts");
    expect(matrixHtml).toContain("bat nettement la référence");
    expect(matrixHtml).not.toContain("trop peu de verdicts vérifiés");
  });
});

// Régression : le rendu lisait autrefois entry.version/attempted_at/change_description/note et
// comparait entry.status à "appliquée" — aucun de ces champs n'a jamais existé côté données
// réelles (voir CLAUDE.md : id, logged_at, trigger, what, why, action, status
// "accepted"/"rejected", validation_score_before_pct/after_pct), donc chaque entrée s'affichait
// vide (juste un séparateur "· " et un badge) malgré un raisonnement réel derrière.
describe("engine.js — renderEngineTab (journal des corrections)", () => {
  const CONTAINER_HTML = `<!doctype html><html><body>
    <div id="engine-pin"></div>
    <div id="engine-summary"></div>
    <div id="engine-matrix"></div>
    <div id="engine-classes"></div>
    <div id="engine-log"></div>
    <div id="engine-calibration"></div>
    <div id="engine-regime-accuracy"></div>
    <div id="engine-opportunities"></div>
    <div id="engine-paper-portfolio"></div>
    <div id="engine-control-group"></div>
  </body></html>`;

  it("shows the empty-state message when correction_log is empty or absent", () => {
    const dom = loadPage(["config.js", "engine.js"], { html: CONTAINER_HTML });
    dom.window.renderEngineTab([], {}, null, null);
    expect(dom.window.document.getElementById("engine-log").textContent).toContain("Aucune correction tentée");
  });

  it("renders the real fields of a rejected attempt (what/why/action/trigger), not blank", () => {
    const dom = loadPage(["config.js", "engine.js"], { html: CONTAINER_HTML });
    const engineHistory = {
      correction_log: [
        {
          id: "corr-20260823-biais-rattrapage-macro",
          logged_at: "2026-08-23T23:20:00Z",
          trigger: "14 nouveaux verdicts résolus en un seul cycle",
          what: "Diagnostic du biais observé sur ce lot",
          why: "Changement de régime macro survenu après l'émission",
          action: "Aucun changement de paramètre appliqué ce cycle",
          status: "rejected",
          validation_score_before_pct: 20,
          validation_score_after_pct: null,
        },
      ],
    };
    dom.window.renderEngineTab([], engineHistory, null, null);
    const html = dom.window.document.getElementById("engine-log").innerHTML;
    expect(html).toContain("Diagnostic du biais observé sur ce lot");
    expect(html).toContain("Changement de régime macro survenu après l'émission");
    expect(html).toContain("Aucun changement de paramètre appliqué ce cycle");
    expect(html).toContain("14 nouveaux verdicts résolus en un seul cycle");
    expect(html).toContain("Rejetée");
    expect(html).toContain("badge-neutral");
    expect(html).toContain("20 %");
    expect(html).toContain("aucun changement appliqué");
  });

  it("renders an accepted attempt with the success badge and a before → after score", () => {
    const dom = loadPage(["config.js", "engine.js"], { html: CONTAINER_HTML });
    const engineHistory = {
      correction_log: [
        {
          id: "corr-test-accepted",
          logged_at: "2026-09-01T10:00:00Z",
          trigger: "5 nouveaux verdicts résolus",
          what: "Test",
          why: "Test",
          action: "threshold_pct ajusté de 5 à 7 pour FET",
          status: "accepted",
          validation_score_before_pct: 40,
          validation_score_after_pct: 55,
        },
      ],
    };
    dom.window.renderEngineTab([], engineHistory, null, null);
    const html = dom.window.document.getElementById("engine-log").innerHTML;
    expect(html).toContain("Appliquée");
    expect(html).toContain("badge-success");
    expect(html).toContain("40 %");
    expect(html).toContain("55 %");
  });
});
