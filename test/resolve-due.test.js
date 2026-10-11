import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadEngine, isQuiet, verdictCurrency, priceNear, verdictOutcome, globalStats, horizonOutcome, matchCurrency, controlStats } from "../scripts/resolve-due.mjs";

const engine = loadEngine();
const NOW = "2026-10-12T16:45:00Z";

describe("scripts/resolve-due.mjs : vérification des échéances sans quota", () => {
  it("ne touche jamais un fichier pendant le créneau de la routine qui l'écrit", () => {
    expect(isQuiet("verdicts", new Date("2026-10-12T16:20:00Z"))).toBe(true);
    expect(isQuiet("verdicts", new Date("2026-10-12T16:45:00Z"))).toBe(false);
    expect(isQuiet("verdicts", new Date("2026-10-12T05:20:00Z"))).toBe(false);
    expect(isQuiet("opportunities", new Date("2026-10-12T04:10:00Z"))).toBe(true);
    expect(isQuiet("control", new Date("2026-10-18T09:10:00Z"))).toBe(true); // dimanche
    expect(isQuiet("control", new Date("2026-10-19T09:10:00Z"))).toBe(false); // lundi
  });

  it("devise d'un verdict : champ, sinon table de la spec (avant 20/09 EUR, après USD sauf CTSI)", () => {
    expect(verdictCurrency({ currency: "USD", issued_at: "2026-08-01T00:00:00Z" })).toBe("USD");
    expect(verdictCurrency({ issued_at: "2026-09-10T00:00:00Z", asset: "bitcoin" })).toBe("EUR");
    expect(verdictCurrency({ issued_at: "2026-09-22T00:00:00Z", asset: "bitcoin" })).toBe("USD");
    expect(verdictCurrency({ issued_at: "2026-09-22T00:00:00Z", asset: "cartesi" })).toBe("EUR");
  });

  it("prix à l'échéance : point le plus proche, à 2 h au plus, sinon rien", () => {
    const t = Date.parse("2026-10-12T16:20:00Z");
    const pts = [[t - 3 * 3600000, 1], [t - 1200000, 2], [t + 2400000, 3]];
    expect(priceNear(pts, "2026-10-12T16:20:00Z")).toBe(2);
    expect(priceNear([[t - 3 * 3600000, 1]], "2026-10-12T16:20:00Z")).toBeNull();
    expect(priceNear([[t, 0], [t, null]], "2026-10-12T16:20:00Z")).toBeNull();
  });

  it("issue d'un verdict : même règle que l'onglet Moteur (classifyActualMove)", () => {
    const v = { verdict: "ACHAT", price_at_issue: 0.0353, threshold_pct: 5 };
    expect(verdictOutcome(v, 0.0372, NOW, engine)).toEqual({ price_at_resolution: 0.0372, actual_move_pct: 5.38, actual_direction: "ACHAT", verdict_correct: true, resolved_at: NOW });
    expect(verdictOutcome(v, 0.0340, NOW, engine)).toMatchObject({ actual_move_pct: -3.68, actual_direction: "ATTENTE", verdict_correct: false });
    expect(verdictOutcome({ ...v, verdict: "VENTE" }, 0.03, NOW, engine)).toMatchObject({ actual_direction: "VENTE", verdict_correct: true });
  });

  it("global_stats recalculé sur les vrais verdicts = chiffres de l'onglet Moteur", () => {
    const verdicts = JSON.parse(readFileSync(new URL("../data/verdicts.json", import.meta.url), "utf-8"));
    const resolved = verdicts.filter((v) => v.status === "resolved").length;
    const live = engine.computeEngineStats(verdicts.filter((v) => v.status === "resolved"));
    const gs = globalStats(verdicts, NOW, engine, { baseline_buy_hold_btc_pct: 18.59 });
    expect(gs.total_verdicts_resolved).toBe(resolved);
    expect(gs.total_verdicts_issued).toBe(verdicts.length);
    expect(gs.accuracy_strict_pct).toBe(Math.round(live.accuracyPct * 100) / 100);
    expect(gs.confusion_matrix.ATTENTE.ATTENTE).toBe(live.matrix.ATTENTE.ATTENTE);
    expect(gs.last_computed_at).toBe(NOW);
    expect(gs.baseline_buy_hold_btc_pct).toBe(18.59); // champ non recalculé : conservé tel quel
  });

  it("horizon d'opportunité : règle de la routine horizons-6h (validé si ≥ seuil)", () => {
    const opp = { price_at_flag: 0.16133, threshold_pct: 5 };
    expect(horizonOutcome(opp, 0.1718216334324273, NOW)).toEqual({ price_at_check: 0.1718216334324273, move_pct: 6.5, validated: true, checked_at: NOW });
    expect(horizonOutcome(opp, 0.16645, NOW)).toMatchObject({ move_pct: 3.17, validated: false });
  });

  it("groupe témoin : devise reconnue seulement quand l'écart est net", () => {
    expect(matchCurrency(0.01607, 0.0161, 0.0139)).toBe("USD");
    expect(matchCurrency(0.0139, 0.0161, 0.0139)).toBe("EUR");
    expect(matchCurrency(0.015, 0.0161, 0.0139)).toBeNull(); // entre les deux : indécidable
    expect(matchCurrency(0.0161, null, 0.0139)).toBeNull();
  });

  it("groupe témoin : statistiques recalculées sur tous les résolus", () => {
    const items = [
      { status: "resolved", outcome: { move_pct: 16.2, validated: true } },
      { status: "resolved", outcome: { move_pct: -10.5, validated: false } },
      { status: "resolved", outcome: { move_pct: 8, validated: true } },
      { status: "pending", outcome: { move_pct: null, validated: null } },
    ];
    const s = controlStats(items, NOW, 5);
    expect(s.total_resolved).toBe(3);
    expect(s.validated_pct).toBe(66.7);
    expect(s.note).toContain("2 actifs sur 3");
    expect(controlStats([], NOW, 5)).toBeNull();
  });
});
