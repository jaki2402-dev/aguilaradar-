import { describe, it, expect } from "vitest";
import { loadSite, indicatorsAt, readingOf, closesUntil, backtest } from "../scripts/technical-favoris.mjs";

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
