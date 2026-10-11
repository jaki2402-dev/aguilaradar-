import { describe, it, expect } from "vitest";
import { loadSite, indicatorsAt, readingOf, closesUntil, backtest, scoreRules, RULES_REGISTERED_AT, technicalEvents, buildTechnicalAlerts, engineCalibration, proposedVerdict, ENGINE_RULE, contextConfidence, selectEngineRule, valuationSeries, valuationAt } from "../scripts/technical-favoris.mjs";

const site = loadSite();
const DAY = 86400000;
const START = Date.parse("2025-10-01T00:00:00Z");

// Série quotidienne [timestamp, cours] à partir de START.
const series = (closes) => closes.map((c, i) => [START + i * DAY, c]);
const iso = (dayIndex, hours = 0) => new Date(START + dayIndex * DAY + hours * 3600000).toISOString();

// MACD de référence écrit indépendamment : EMA « à la pandas » (adjust=False, amorcée sur la 1re
// valeur et non sur une moyenne simple). Les deux amorçages convergent sur une longue série.
function referenceMacd(closes) {
  const ema = (values, span) => {
    const k = 2 / (span + 1);
    const out = [values[0]];
    for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
    return out;
  };
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(line, 9);
  const last = closes.length - 1;
  return { line: line[last], signal: signal[last], histogram: line[last] - signal[last] };
}

describe("scripts/technical-favoris.mjs : mêmes calculs que le site", () => {
  it("charge les 15 favoris et les fonctions de js/detail.js", () => {
    expect(site.FAVORIS).toHaveLength(15);
    expect(site.FAVORIS.map((f) => f.cgId)).toContain("zelcash");
    expect(typeof site.computeMACD).toBe("function");
  });

  it("MACD : identique à une implémentation indépendante sur une longue série bruitée", () => {
    let x = 100;
    let seed = 7;
    const closes = [];
    for (let i = 0; i < 365; i++) {
      seed = (seed * 16807) % 2147483647;
      x *= 1 + ((seed / 2147483647) - 0.5) * 0.08;
      closes.push(x);
    }
    const got = site.computeMACD(closes);
    const ref = referenceMacd(closes);
    for (const k of ["line", "signal", "histogram"]) expect(got[k]).toBeCloseTo(ref[k], 8);
  });

  it("MACD : propriétés connues (série constante → 0 ; droite de pente 1 → ligne 7, histogramme 0)", () => {
    expect(site.computeMACD(new Array(100).fill(5)).histogram).toBeCloseTo(0, 12);
    const line = site.computeMACD(Array.from({ length: 300 }, (_, i) => i));
    // Retard d'une EMA de période N sur une droite = (N − 1) / 2 : 12,5 − 5,5 = 7.
    expect(line.line).toBeCloseTo(7, 6);
    expect(line.histogram).toBeCloseTo(0, 6);
    expect(site.computeMACD(new Array(34).fill(1))).toBeNull();
  });

  it("indicateurs au dernier point d'une hausse régulière de 1 %/jour", () => {
    const closes = Array.from({ length: 400 }, (_, i) => 100 * 1.01 ** i);
    const ind = indicatorsAt(closes, site);
    expect(ind.rsi14).toBe(100);
    expect(ind.change_pct["7d"]).toBe(7.2);
    expect(ind.change_pct["30d"]).toBe(34.8);
    expect(ind.sma50_above_sma200).toBe(true);
    expect(ind.sma200_gap_pct).toBeGreaterThan(100);
    expect(ind.macd_histogram).toBeGreaterThan(0);
    expect(ind.volatility_30d_pct).toBe(0);
    expect(ind.drawdown_from_365d_high_pct).toBe(0);
  });

  it("historique trop court : rien plutôt qu'un chiffre faux ; sans 200 jours, pas de tendance de fond", () => {
    expect(indicatorsAt([1, 2, 3], site)).toBeNull();
    const ind = indicatorsAt(Array.from({ length: 60 }, (_, i) => 10 + (i % 3)), site);
    expect(ind.sma200).toBeNull();
    expect(ind.sma200_gap_pct).toBeNull();
    expect(ind.sma50_above_sma200).toBeNull();
    expect(ind.change_pct["90d"]).toBeNull();
  });
});

describe("lecture en une phrase (règles fixes)", () => {
  it("tendance, élan et surachat", () => {
    expect(readingOf({ sma200_gap_pct: 30.4, macd_histogram: 0.0003, rsi14: 71 })).toBe(
      "Tendance de fond haussière (+30 % vs moyenne 200 j), élan positif ; RSI 71 : surachat, mouvement étiré."
    );
  });

  it("tendance baissière en survente", () => {
    expect(readingOf({ sma200_gap_pct: -42.6, macd_histogram: -1, rsi14: 24.2 })).toBe(
      "Tendance de fond baissière (-43 % vs moyenne 200 j), élan négatif ; RSI 24 : survente."
    );
  });

  it("données partielles : seulement ce qui est connu", () => {
    expect(readingOf({ sma200_gap_pct: null, macd_histogram: null, rsi14: 50 })).toBe("RSI 50 neutre.");
    expect(readingOf(null)).toBeNull();
  });
});

describe("analyse rétrospective des verdicts", () => {
  it("n'utilise que les cours connus au moment de l'émission", () => {
    const points = series([1, 2, 3, 4]);
    expect(closesUntil(points, iso(1, 12))).toEqual([1, 2]);
    expect(closesUntil(points, iso(2))).toEqual([1, 2, 3]);
  });

  // Actif « up » : 250 jours de hausse puis effondrement ; actif « down » : baisse continue.
  const up = series([...Array.from({ length: 250 }, (_, i) => 100 + i), ...Array.from({ length: 50 }, (_, i) => 349 - i * 6)]);
  const down = series(Array.from({ length: 300 }, (_, i) => 500 - i));
  const verdict = (asset, day, verdict, actual, correct, status = "resolved") => ({
    asset,
    issued_at: iso(day, 0.5),
    verdict,
    status,
    outcome: status === "resolved" ? { actual_direction: actual, verdict_correct: correct } : null,
  });

  const verdicts = [
    verdict("up", 240, "ATTENTE", "ACHAT", false),
    verdict("down", 260, "VENTE", "VENTE", true),
    verdict("up", 245, "ACHAT", null, null, "pending"),
    verdict("inconnu", 260, "ACHAT", "ACHAT", true),
    verdict("down", 5, "ACHAT", "VENTE", false), // moins de 15 jours d'historique : écarté
  ];
  const result = backtest(verdicts, { up, down }, site);

  it("échantillon : seulement les verdicts vérifiés avec un historique suffisant", () => {
    expect(result.sample).toBe(2);
    expect(result.first_issued_at).toBe(iso(240, 0.5));
    expect(result.engine_accuracy_pct).toBe(50);
  });

  it("le jour J, l'effondrement ultérieur de « up » est invisible : tendance haussière, surachat", () => {
    expect(result.by_trend.au_dessus_mm200).toEqual({ n: 1, engine_correct: 0, actual: { ACHAT: 1, ATTENTE: 0, VENTE: 0 } });
    expect(result.by_trend.en_dessous_mm200).toEqual({ n: 1, engine_correct: 1, actual: { ACHAT: 0, ATTENTE: 0, VENTE: 1 } });
    expect(result.by_rsi_zone.surachat.n).toBe(1);
    expect(result.by_rsi_zone.survente.n).toBe(1);
    expect(result.trend_rule).toEqual({ n: 2, accuracy_pct: 100 });
  });

  it("aucun verdict exploitable : échantillon vide, pas de pourcentage inventé", () => {
    const empty = backtest([], {}, site);
    expect(empty.sample).toBe(0);
    expect(empty.engine_accuracy_pct).toBeNull();
    expect(empty.trend_rule.accuracy_pct).toBeNull();
  });
});

describe("analyse rétrospective : répartition des choix du moteur et des issues réelles", () => {
  it("compte chaque verdict du moteur et son exactitude, et les issues réelles", () => {
    const up = series(Array.from({ length: 300 }, (_, i) => 100 + i));
    const mk = (day, verdict, actual, correct) => ({ asset: "up", issued_at: iso(day, 0.5), verdict, status: "resolved", outcome: { actual_direction: actual, verdict_correct: correct } });
    const r = backtest([mk(220, "ATTENTE", "ACHAT", false), mk(230, "ATTENTE", "ATTENTE", true), mk(240, "ACHAT", "ACHAT", true)], { up }, site);
    expect(r.engine_calls).toEqual({ ACHAT: { n: 1, correct: 1 }, ATTENTE: { n: 2, correct: 1 }, VENTE: { n: 0, correct: 0 } });
    expect(r.actual).toEqual({ ACHAT: 2, ATTENTE: 1, VENTE: 0 });
  });

  it("cours arrondis à 6 chiffres significatifs", () => {
    const ind = indicatorsAt(Array.from({ length: 220 }, (_, i) => 0.0123456789 + i * 1e-5), site);
    expect(ind.price_usd).toBe(0.0145357);
  });
});

describe("règles candidates figées le 11/10 (test réel sur les issues postérieures)", () => {
  const row = (verdict, actual, ind, resolvedAt = "2026-10-05T08:00:00Z") => ({ v: { verdict, outcome: { actual_direction: actual, resolved_at: resolvedAt } }, ind: { rsi14: 50, sma200_gap_pct: 10, macd_histogram: 1, ...ind } });

  it("chaque règle appliquée telle que définie", () => {
    const r = scoreRules([
      row("ACHAT", "ATTENTE", { rsi14: 75 }), // garde-fou et tendance : ATTENTE (juste)
      row("ATTENTE", "ACHAT", {}), // tendance + RSI : au-dessus, RSI 50 → ACHAT (juste)
      row("ATTENTE", "VENTE", { sma200_gap_pct: -5, macd_histogram: -1 }), // tendance : VENTE (juste)
    ]).retrospective;
    expect(r.n).toBe(3);
    expect(r.results.moteur).toEqual({ n: 3, correct: 0, pct: 0 });
    expect(r.results.garde_fou_rsi).toEqual({ n: 3, correct: 1, pct: 33.3 });
    expect(r.results.tendance_rsi).toEqual({ n: 3, correct: 3, pct: 100 }); // RSI 75 au-dessus de la MM200 → ATTENTE (juste)
    expect(r.results.toujours_achat).toEqual({ n: 3, correct: 1, pct: 33.3 });
    expect(r.results.retour_moyenne_rsi).toEqual({ n: 3, correct: 1, pct: 33.3 }); // RSI 75 → VENTE (faux), puis ACHAT, ACHAT
  });

  it("seules les issues connues APRÈS la date des règles comptent comme test réel", () => {
    const r = scoreRules([row("ACHAT", "ACHAT", {}), row("ACHAT", "VENTE", {}, "2026-10-12T16:45:00Z")]);
    expect(r.registered_at).toBe(RULES_REGISTERED_AT);
    expect(r.retrospective.n).toBe(1);
    expect(r.prospective.n).toBe(1);
    expect(r.prospective.results.moteur).toEqual({ n: 1, correct: 0, pct: 0 });
    expect(scoreRules([]).prospective).toMatchObject({ n: 0, results: { moteur: { n: 0, correct: 0, pct: null } } });
    // Règle ajoutée plus tard : sa propre date sépare passé et test réel.
    const late = scoreRules([row("ACHAT", "ACHAT", {}, "2026-10-11T09:02:00Z")]);
    expect(late.prospective.results.moteur.n).toBe(1);
    expect(late.retrospective.results.retour_moyenne_rsi.n).toBe(1);
    expect(late.definitions.retour_moyenne_rsi.registered_at).toBe("2026-10-11T09:05:00Z");
  });

  it("verdict sans RSI ou sans MM200 à l'émission : écarté pour toutes les règles (comparaison à égalité)", () => {
    expect(scoreRules([row("ACHAT", "ACHAT", { rsi14: null }), row("ACHAT", "ACHAT", { sma200_gap_pct: null })]).retrospective.n).toBe(0);
  });
});

describe("alertes techniques : seulement les bascules d'un jour à l'autre", () => {
  const prev = {
    LPT: { sma200_gap_pct: 3.6, rsi14: 50 },
    CTSI: { sma200_gap_pct: 27.8, rsi14: 68 },
    ETH: { sma200_gap_pct: 17.6, rsi14: 28.8 }, // déjà en survente hier : pas de nouvelle alerte
    TIA: { sma200_gap_pct: -2, rsi14: 50 },
  };
  const now = {
    LPT: { sma200_gap_pct: -1.2, rsi14: 45 },
    CTSI: { sma200_gap_pct: 30.1, rsi14: 71.6 },
    ETH: { sma200_gap_pct: 15, rsi14: 25 },
    TIA: { sma200_gap_pct: 4.4, rsi14: 55 },
    PEAQ: { sma200_gap_pct: -5, rsi14: 20 }, // absent hier : rien à comparer
  };
  const NOW = "2026-10-11T23:31:00Z";

  it("détecte les passages de la MM200 (prioritaires) puis l'entrée en surachat/survente", () => {
    expect(technicalEvents(prev, now).map((e) => `${e.ticker}:${e.kind}`)).toEqual(["LPT:mm200_dessous", "TIA:mm200_dessus", "CTSI:rsi_surachat"]);
    expect(technicalEvents(null, now)).toEqual([]);
  });

  it("messages factuels, sans conseil", () => {
    const alerts = buildTechnicalAlerts(technicalEvents(prev, now), [], NOW);
    expect(alerts.map((a) => a.message)).toEqual([
      "LPT passe sous sa moyenne 200 jours (−1 %) : la tendance de fond devient baissière. Mesure automatique sur les cours, pas un conseil.",
      "TIA repasse au-dessus de sa moyenne 200 jours (+4 %) : la tendance de fond redevient haussière. Mesure automatique sur les cours, pas un conseil.",
      "CTSI entre en zone de surachat (RSI 14 j à 72) : hausse déjà étirée, le risque de repli augmente. Tendance de fond : +30 % vs moyenne 200 j. Mesure automatique sur les cours, pas un conseil.",
    ]);
    expect(alerts[0]).toMatchObject({ id: "alert-20261011-lpt-mm200-dessous", ticker_ou_theme: "LPT", type: "signal_technique", signal_kind: "mm200_dessous", sentiment: "négatif", triggered_at: NOW });
  });

  it("au plus 3 par passage, et pas deux fois la même bascule pour un actif en 7 jours", () => {
    const many = ["A", "B", "C", "D"].map((t) => ({ ticker: t, kind: "rsi_surachat", now: { rsi14: 71, sma200_gap_pct: 1 } }));
    expect(buildTechnicalAlerts(many, [], NOW)).toHaveLength(3);
    const recent = [{ id: "x", type: "signal_technique", ticker_ou_theme: "A", signal_kind: "rsi_surachat", triggered_at: "2026-10-06T23:30:00Z" }];
    expect(buildTechnicalAlerts(many, recent, NOW).map((a) => a.ticker_ou_theme)).toEqual(["B", "C", "D"]);
    const old = [{ ...recent[0], triggered_at: "2026-10-01T23:30:00Z" }];
    expect(buildTechnicalAlerts(many, old, NOW).map((a) => a.ticker_ou_theme)).toEqual(["A", "B", "C"]);
  });
});

describe("règle du moteur depuis le 11/10 : verdict proposé et confiance mesurée", () => {
  const row = (actual, rsi14) => ({ v: { verdict: "ATTENTE", outcome: { actual_direction: actual } }, ind: { rsi14, sma200_gap_pct: 1, macd_histogram: 1 } });
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => row(i < 7 ? "ACHAT" : "VENTE", 50)), // 7/12 ACHAT justes
    ...Array.from({ length: 4 }, (_, i) => row(i < 2 ? "VENTE" : "ACHAT", 75)), // 2/4 VENTE justes
  ];

  it("règle adoptée : VENTE si RSI ≥ 70, sinon ACHAT", () => {
    expect(ENGINE_RULE).toBe("retour_moyenne_rsi");
    const cal = engineCalibration(rows);
    expect(cal.ACHAT).toMatchObject({ n: 12, correct: 7, pct: 58 });
    expect(cal.VENTE).toMatchObject({ n: 4, correct: 2, pct: 50 });
  });

  it("confiance = taux de réussite mesuré de l'appel, seulement à partir de 10 cas", () => {
    const cal = engineCalibration(rows);
    expect(proposedVerdict({ rsi14: 52, sma200_gap_pct: 5 }, cal)).toMatchObject({ verdict: "ACHAT", confidence_pct: 58, sample_n: 12 });
    expect(proposedVerdict({ rsi14: 71.6, sma200_gap_pct: 5 }, cal)).toMatchObject({ verdict: "VENTE", confidence_pct: null, sample_n: 4 });
    expect(proposedVerdict({ rsi14: 71.6, sma200_gap_pct: 5 }, cal).basis).toBe("RSI 72 ≥ 70 : hausse étirée, repli plus fréquent ensuite");
  });

  it("confiance ajustée selon l'élan du bitcoin (rétrécie vers le taux global)", () => {
    const mk = (actual, btc) => ({ v: { verdict: "ATTENTE", outcome: { actual_direction: actual } }, ind: { rsi14: 50, sma200_gap_pct: 1, macd_histogram: 1 }, market: { macd_histogram: btc, sma200_gap_pct: 5 } });
    // 10 cas élan BTC négatif : 8 hausses ; 10 cas élan positif : 2 hausses → taux global 50 %.
    const ctxRows = [...Array.from({ length: 10 }, (_, i) => mk(i < 8 ? "ACHAT" : "VENTE", -1)), ...Array.from({ length: 10 }, (_, i) => mk(i < 2 ? "ACHAT" : "VENTE", 1))];
    const cal = engineCalibration(ctxRows);
    expect(contextConfidence(cal, "ACHAT", { macd_histogram: -1 })).toBe(65); // (8 + 10 × 0,5) / 20
    expect(contextConfidence(cal, "ACHAT", { macd_histogram: 1 })).toBe(35);
    expect(contextConfidence(cal, "ACHAT", null)).toBe(50);
    expect(proposedVerdict({ rsi14: 50, sma200_gap_pct: 1 }, cal, ENGINE_RULE, { macd_histogram: 1 })).toMatchObject({ confidence_pct: 35, context: "élan du bitcoin positif", context_n: 10 });
  });

  it("auto-sélection : change de règle seulement avec ≥ 20 cas et ≥ 5 points d'avance", () => {
    const mk = (actual, gap, i) => ({ v: { verdict: "ATTENTE", outcome: { actual_direction: actual, resolved_at: `2026-10-${String(10 + (i % 20)).padStart(2, "0")}T00:00:00Z` } }, ind: { rsi14: 50, sma200_gap_pct: gap, macd_histogram: 1 }, market: null });
    // Marché devenu directionnel à la baisse : cours sous la MM200 et baisses → la tendance gagne
    // (élan MACD positif : la règle figée « tendance + RSI » dirait ATTENTE, seule « tendance » dit VENTE).
    const bear = Array.from({ length: 30 }, (_, i) => mk(i < 24 ? "VENTE" : "ACHAT", -10, i));
    const sel = selectEngineRule("retour_moyenne_rsi", bear);
    expect(sel).toMatchObject({ id: "tendance_pure", switched: true, from: "retour_moyenne_rsi", window_n: 30 });
    expect(sel.scores.tendance_pure).toBe(80);
    expect(selectEngineRule("retour_moyenne_rsi", bear.slice(0, 19)).switched).toBe(false); // trop peu de cas
    // Avance trop faible : on garde la règle en place.
    // 15 baisses, 1 stable, 14 hausses : tendance 50 % contre 46,7 % → 3,3 points, sous la marge.
    const close = Array.from({ length: 30 }, (_, i) => mk(i < 15 ? "VENTE" : i === 15 ? "ATTENTE" : "ACHAT", -10, i));
    expect(selectEngineRule("retour_moyenne_rsi", close).id).toBe("retour_moyenne_rsi");
    expect(selectEngineRule("inconnue", []).id).toBe("retour_moyenne_rsi");
  });

  it("sans RSI : ATTENTE, jamais un appel deviné", () => {
    expect(proposedVerdict({ rsi14: null }, null)).toMatchObject({ verdict: "ATTENTE", confidence_pct: null });
    expect(proposedVerdict(null, null).verdict).toBe("ATTENTE");
  });
});

describe("valorisation : capitalisation / volume moyen 30 j, situé dans SA fourchette sur 1 an", () => {
  const DAY = 86400000;
  const t0 = Date.parse("2025-10-11T00:00:00Z");
  it("ratio d'aujourd'hui au plus bas de l'année → score 10 ; au plus haut → 0", () => {
    const caps = Array.from({ length: 200 }, (_, i) => [t0 + i * DAY, 1000 + i]); // capitalisation qui monte
    const vols = Array.from({ length: 200 }, (_, i) => [t0 + i * DAY, 100]);
    const rising = valuationAt(valuationSeries(caps, vols));
    expect(rising).toMatchObject({ percentile: 100, score: 0 });
    const falling = valuationAt(valuationSeries(caps.map(([t], i) => [t, 2000 - i]), vols));
    expect(falling).toMatchObject({ percentile: 0, score: 10 });
    expect(falling.ratio).toBe(18); // 1801 / 100 (moyenne sur 30 j)
  });
  it("moins de 4 mois d'historique : pas de score ; jamais de donnée postérieure à la date demandée", () => {
    const caps = Array.from({ length: 100 }, (_, i) => [t0 + i * DAY, 1000]);
    const vols = Array.from({ length: 100 }, (_, i) => [t0 + i * DAY, 100]);
    expect(valuationAt(valuationSeries(caps, vols))).toBeNull();
    const caps2 = Array.from({ length: 300 }, (_, i) => [t0 + i * DAY, 1000 + i]);
    const vols2 = Array.from({ length: 300 }, (_, i) => [t0 + i * DAY, 100]);
    expect(valuationAt(valuationSeries(caps2, vols2), t0 + 150 * DAY).days).toBe(132); // jours 19 à 150 (20 jours de volume minimum)
  });
});
