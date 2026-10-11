import { describe, it, expect } from "vitest";
import { dailySeries, classify, buildSamples, splitByTime, evaluateRules, learnTree, treeCall, describeTree, featureReport, errorAnalysis, riskFlags, labCalibration, MIN_LEAF, FEATURES } from "../scripts/engine-lab.mjs";
import { loadSite, indicatorsAt, valuationAt, CANDIDATE_RULES, chooseEngineRule } from "../scripts/technical-favoris.mjs";

const site = loadSite();
const deps = { indicatorsAt, valuationAt, site };
const DAY = 86400000;
const T0 = Date.parse("2025-10-11T00:00:00Z");

// Cas synthétique : f.x décide seul de l'issue (x < 0 → baisse, x ≥ 0 → hausse).
const sample = (day, x, actual, extra = {}) => ({ ticker: "T", day, f: { x, rsi14: 50, sma200_gap_pct: 1, macd_histogram: 1, btc_macd: extra.btc ?? -1, ...extra }, actual });

describe("laboratoire : données de base", () => {
  it("un point par jour (00h00), le point « maintenant » est écarté", () => {
    const pts = [[T0, 1], [T0 + DAY, 2], [T0 + DAY + 3600000 * 5, 2.1]];
    expect(dailySeries(pts)).toEqual([{ day: T0 / DAY, value: 1 }, { day: T0 / DAY + 1, value: 2 }]);
  });

  it("issue réelle : même seuil ±5 % que la résolution des verdicts", () => {
    expect(classify(5)).toBe("ACHAT");
    expect(classify(4.99)).toBe("ATTENTE");
    expect(classify(-5)).toBe("VENTE");
  });

  it("cas réels : 200 jours d'historique exigés, issue lue à l'horizon de l'actif, jamais après la fin", () => {
    const n = 260;
    const closes = Array.from({ length: n }, (_, i) => ({ day: T0 / DAY + i, value: 100 * 1.004 ** i }));
    const asset = { ticker: "AAA", cgId: "aaa", closes, volByDay: new Map(closes.map((c) => [c.day, 1e6])), valuation: [], horizon: 14 };
    const btc = { ticker: "BTC", cgId: "bitcoin", closes, volByDay: new Map(), valuation: [], horizon: 14 };
    const s = buildSamples([asset], btc, null, deps);
    expect(s).toHaveLength(n - 14 - 199); // jours 199 à 245
    expect(s[0].day).toBe(T0 / DAY + 199);
    expect(s.every((x) => x.actual === "ACHAT")).toBe(true); // +0,4 %/jour sur 14 j = +5,8 %
    expect(s[0].f.rel_strength_30d).toBe(0); // même série que le bitcoin
    expect(s[0].f.volume_ratio).toBe(1);
  });

  it("découpage dans le temps : les 60 % de jours les plus anciens pour apprendre", () => {
    const s = Array.from({ length: 10 }, (_, d) => sample(d, 0, "ACHAT"));
    const { train, valid, cutDay } = splitByTime(s);
    expect(cutDay).toBe(6);
    expect(train.map((x) => x.day)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(valid.map((x) => x.day)).toEqual([6, 7, 8, 9]);
  });
});

describe("laboratoire : règle apprise, valeur prédictive, erreurs", () => {
  // 400 cas : x uniforme de −1 à 1 ; x < 0 → VENTE, sinon ACHAT ; 10 % de bruit (ATTENTE).
  const data = Array.from({ length: 400 }, (_, i) => {
    const x = -1 + (2 * (i * 37 % 400)) / 400;
    const actual = i % 10 === 0 ? "ATTENTE" : x < 0 ? "VENTE" : "ACHAT";
    return sample(i, x, actual);
  });
  const FEATS_KEY = "x";

  it("la règle apprise retrouve un vrai signal et le décrit en clair", () => {
    FEATURES[FEATS_KEY] = "Signal test";
    const { train, valid } = splitByTime(data);
    const tree = learnTree(train);
    const acc = valid.filter((s) => treeCall(tree, s.f) === s.actual).length / valid.length;
    // Seuils = terciles (−0,33 / +0,33), pas 0 : le tiers central reste à moitié ambigu → ~74 %
    // atteignables, contre 33 % au hasard et 45 % pour « toujours ACHAT ».
    expect(acc).toBeGreaterThan(0.7);
    expect(describeTree(tree).join(" ; ")).toContain("Signal test");
    // Chaque branche couvre au moins MIN_LEAF cas d'apprentissage.
    const leaves = [];
    const walk = (n) => (n.leaf ? leaves.push(n.n) : (walk(n.left), walk(n.right)));
    walk(tree);
    expect(Math.min(...leaves)).toBeGreaterThanOrEqual(MIN_LEAF);
    delete FEATURES[FEATS_KEY];
  });

  it("valeur prédictive : signalée seulement si l'écart tient sur les deux périodes", () => {
    FEATURES[FEATS_KEY] = "Signal test";
    const { train, valid } = splitByTime(data);
    const report = featureReport(data, train, valid);
    const x = report.find((r) => r.key === FEATS_KEY);
    expect(x.predictive).toBe(true);
    expect(x.direction).toBe("plus haut → plus de hausses");
    const rsi = report.find((r) => r.key === "rsi14");
    expect(rsi === undefined || rsi.predictive === false).toBe(true); // RSI constant : aucun signal
    delete FEATURES[FEATS_KEY];
  });

  it("analyse des erreurs : zones où la règle se trompe le plus, et vigilance du jour", () => {
    FEATURES[FEATS_KEY] = "Signal test";
    const alwaysBuy = () => "ACHAT";
    const a = errorAnalysis(data, alwaysBuy);
    expect(a.worst[0]).toMatchObject({ key: "x", zone: "bas" });
    expect(a.worst[0].error_pct).toBeGreaterThan(90);
    expect(riskFlags({ x: -0.9 }, a, a.error_pct)[0]).toContain("Signal test bas");
    expect(riskFlags({ x: 0.9 }, a, a.error_pct)).toEqual([]);
    delete FEATURES[FEATS_KEY];
  });

  it("confiance : taux de l'appel sur la période récente, séparé selon l'élan du bitcoin", () => {
    const s = [sample(1, 0, "ACHAT", { btc: -1 }), sample(2, 0, "VENTE", { btc: 1 }), sample(3, 0, "ACHAT", { btc: -1 })];
    const cal = labCalibration(s, () => "ACHAT");
    expect(cal.ACHAT).toMatchObject({ n: 3, correct: 2, pct: 67 });
    expect(cal.ACHAT.btc).toEqual({ hausse: { n: 1, correct: 0 }, baisse: { n: 2, correct: 2 } });
  });

  it("les règles candidates sont notées sur les mêmes cas, période ancienne et récente", () => {
    const { train, valid } = splitByTime(data);
    const scores = evaluateRules(CANDIDATE_RULES, train, valid);
    expect(Object.keys(scores)).toContain("retour_moyenne_rsi");
    expect(scores.moteur).toBeUndefined(); // dépend du verdict émis : pas une règle autonome
    expect(scores.retour_moyenne_rsi.valid).toBeGreaterThan(0);
  });
});

describe("choix de la règle du moteur : laboratoire d'abord, verdicts réels en garde-fou", () => {
  const lab = { retour_moyenne_rsi: { valid: 55 }, regle_apprise: { valid: 60 }, tendance_pure: { valid: 40 } };
  it("change seulement avec ≥ 2 points d'avance sur ≥ 300 cas récents", () => {
    expect(chooseEngineRule("retour_moyenne_rsi", lab, 500, {})).toMatchObject({ id: "regle_apprise", switched: true });
    expect(chooseEngineRule("retour_moyenne_rsi", lab, 200, {}).switched).toBe(false);
    expect(chooseEngineRule("retour_moyenne_rsi", { ...lab, regle_apprise: { valid: 56 } }, 500, {}).switched).toBe(false);
  });
  it("refuse une règle qui fait nettement pire sur les verdicts réels récents", () => {
    expect(chooseEngineRule("retour_moyenne_rsi", lab, 500, { retour_moyenne_rsi: 70, regle_apprise: 60 }).switched).toBe(false);
    expect(chooseEngineRule("retour_moyenne_rsi", lab, 500, { retour_moyenne_rsi: 70, regle_apprise: 66 }).switched).toBe(true);
  });
});
