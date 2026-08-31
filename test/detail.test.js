import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

describe("detail.js — computeSMA", () => {
  const dom = loadPage(["prices.js", "detail.js"]);
  const { computeSMA } = dom.window;

  it("averages the last `period` closes", () => {
    expect(computeSMA([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(computeSMA([1, 2, 3, 4, 5], 3)).toBe(4); // moyenne de [3,4,5]
  });

  it("returns null when there is not enough history", () => {
    expect(computeSMA([1, 2, 3, 4, 5], 6)).toBeNull();
  });
});

describe("detail.js — computeRSI / computeRSIAt", () => {
  const dom = loadPage(["prices.js", "detail.js"]);
  const { computeRSI, computeRSIAt } = dom.window;

  it("returns null when there is not enough history (needs period+1 points)", () => {
    expect(computeRSI([1, 2, 3], 5)).toBeNull();
  });

  it("returns exactly 100 on a pure uptrend (avgLoss === 0 branch, no division)", () => {
    const closes = Array.from({ length: 11 }, (_, i) => 10 + i); // strictement croissant
    expect(computeRSI(closes, 10)).toBe(100);
  });

  it("computes RSI on a hand-verified mixed up/down series", () => {
    // closes=[10,12,11,13,12], period=4 : deltas +2,-1,+2,-1 -> gains=4, pertes=2,
    // avgGain=1, avgLoss=0.5, RS=2, RSI=100-100/3. Vérifié par calcul manuel ET recoupé
    // avec la vraie fonction avant d'écrire ce test (voir session de travail).
    expect(computeRSI([10, 12, 11, 13, 12], 4)).toBeCloseTo(100 - 100 / 3, 10);
  });

  it("computeRSIAt on a truncated slice matches computeRSI called directly on that same slice", () => {
    const closes = [10, 12, 11, 13, 12, 14, 13, 15];
    const endIndex = 4; // équivalent à closes.slice(0, 5) = [10,12,11,13,12]
    expect(computeRSIAt(closes, 4, endIndex)).toBe(computeRSI(closes.slice(0, endIndex + 1), 4));
  });
});

describe("detail.js — computeCorrelation", () => {
  const dom = loadPage(["prices.js", "detail.js"]);
  const { computeCorrelation } = dom.window;

  // Construit une série B dont les rendements sont exactement l'opposé de ceux de A —
  // identité algébrique, pas une décimale devinée : retB[i] = -retA[i] par construction.
  function buildAntiCorrelated(a) {
    const b = [a[0]];
    for (let i = 1; i < a.length; i++) {
      const ret = (a[i] - a[i - 1]) / a[i - 1];
      b.push(b[i - 1] * (1 - ret));
    }
    return b;
  }

  const wiggly = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109, 111];

  it("returns null with fewer than 10 shared points", () => {
    expect(computeCorrelation(wiggly.slice(0, 9), wiggly.slice(0, 9))).toBeNull();
  });

  it("a series correlated with itself is exactly 1 (mathematical identity: cov(X,X)/var(X) = 1)", () => {
    expect(computeCorrelation(wiggly, wiggly)).toBeCloseTo(1, 9);
  });

  it("a series correlated with its exact return-inverse is exactly -1", () => {
    expect(computeCorrelation(wiggly, buildAntiCorrelated(wiggly))).toBeCloseTo(-1, 9);
  });

  it("returns null when one series has zero variance in its returns (flat price)", () => {
    const flat = Array(11).fill(100);
    expect(computeCorrelation(wiggly, flat)).toBeNull();
  });
});

describe("detail.js — detectDivergence", () => {
  const dom = loadPage(["prices.js", "detail.js"]);
  const { detectDivergence, computeRSI, computeRSIAt } = dom.window;

  it("returns null with fewer than 35 points", () => {
    expect(detectDivergence(Array(34).fill(0).map((_, i) => 100 + i))).toBeNull();
  });

  it("finds no divergence on a pure linear uptrend (RSI pinned at 100 throughout, nothing to diverge from)", () => {
    const linear = Array.from({ length: 35 }, (_, i) => 100 + i);
    expect(detectDivergence(linear)).toBeNull();
  });

  it("detects a bearish divergence when price is near its recent high but RSI has cooled since ~3 weeks ago", () => {
    // Montée nette sur 21 points, puis 14 points qui tassent tout en restant près du
    // sommet — construit puis vérifié contre les vraies fonctions (pas de valeur devinée) :
    // les assertions ci-dessous recalculent rsiNow/rsiPast indépendamment plutôt que de
    // recopier une décimale.
    const rise = Array.from({ length: 21 }, (_, i) => 100 + i * 2);
    const chop = [];
    let v = rise[rise.length - 1];
    for (let i = 0; i < 14; i++) {
      v += i % 2 === 0 ? 1 : -1.6;
      chop.push(v);
    }
    const closes = rise.concat(chop);
    const divergence = detectDivergence(closes);
    expect(divergence).not.toBeNull();
    expect(divergence.type).toBe("bearish");
    expect(divergence.rsiNow).toBe(computeRSI(closes, 14));
    expect(divergence.rsiPast).toBe(computeRSIAt(closes, 14, closes.length - 21));
    expect(divergence.rsiNow).toBeLessThan(divergence.rsiPast - 5);
  });
});

describe("detail.js — computeVolumeProfile / volumeProfileSignal", () => {
  const dom = loadPage(["prices.js", "detail.js"]);
  const { computeVolumeProfile, volumeProfileSignal } = dom.window;

  it("returns null on too little data, mismatched array lengths, or a flat price (no range to bin)", () => {
    expect(computeVolumeProfile([1, 2, 3], [1, 2, 3], 4)).toBeNull();
    expect(computeVolumeProfile(Array(10).fill(1), Array(3).fill(1), 4)).toBeNull();
    expect(computeVolumeProfile(Array(10).fill(5), Array(10).fill(1), 4)).toBeNull();
  });

  it("finds the point of control in the bin with the most volume, with a value area bracketing it", () => {
    // La plupart du volume est concentré près de 100-101 ; quelques points épars vers 108-109
    // avec un faible volume ne doivent pas déplacer le point de contrôle.
    const closes = [100, 100.5, 101, 101.2, 108, 108.5, 109, 100.3, 101.8, 109.5, 100.1, 101.4];
    const volumes = [500, 900, 700, 600, 50, 40, 60, 550, 650, 45, 500, 620];
    const vp = computeVolumeProfile(closes, volumes, 4);
    expect(vp).not.toBeNull();
    // Invariant structurel qui doit toujours être vrai, quelle que soit la donnée :
    expect(vp.val).toBeLessThanOrEqual(vp.poc);
    expect(vp.poc).toBeLessThanOrEqual(vp.vah);
    // Le point de contrôle doit tomber dans le groupe bas-prix, là où le volume est concentré.
    expect(vp.poc).toBeLessThan(103);
    // Valeur exacte recoupée avec la vraie fonction avant d'écrire ce test.
    expect(vp.poc).toBeCloseTo(101.1875, 6);
  });

  it("labels the price relative to the value area: near POC / in value area / above / below", () => {
    const vp = { poc: 100, val: 90, vah: 110 };
    expect(volumeProfileSignal(100, vp).label).toContain("proche du point de contrôle");
    expect(volumeProfileSignal(95, vp).label).toContain("dans la zone de valeur");
    expect(volumeProfileSignal(115, vp).label).toContain("au-dessus de la zone de valeur");
    expect(volumeProfileSignal(85, vp).label).toContain("en dessous de la zone de valeur");
  });

  it("returns null when there is no volume profile or no current price", () => {
    expect(volumeProfileSignal(100, null)).toBeNull();
    expect(volumeProfileSignal(null, { poc: 1, val: 1, vah: 1 })).toBeNull();
  });
});

describe("detail.js — technicalSignalSentences", () => {
  const dom = loadPage(["prices.js", "detail.js"]);
  const { technicalSignalSentences } = dom.window;

  it("flags a bullish SMA alignment (price > SMA20 > SMA50)", () => {
    const lines = technicalSignalSentences(110, 105, 100, 50, null);
    expect(lines.map((l) => l.label)).toContain("Alignement haussier des moyennes");
  });

  it("flags a bearish SMA alignment (price < SMA20 < SMA50)", () => {
    const lines = technicalSignalSentences(90, 95, 100, 50, null);
    expect(lines.map((l) => l.label)).toContain("Alignement baissier des moyennes");
  });

  it("falls back to 'moyennes mêlées' when price/SMA20/SMA50 are not cleanly aligned either way", () => {
    const lines = technicalSignalSentences(100, 105, 95, 50, null);
    expect(lines.map((l) => l.label)).toContain("Moyennes mêlées");
  });

  it("skips the SMA line entirely when either SMA is null", () => {
    const lines = technicalSignalSentences(100, null, null, null, null);
    expect(lines).toEqual([]);
  });

  it("flags overbought/oversold/neutral RSI zones with the rounded value in the label", () => {
    expect(technicalSignalSentences(100, null, null, 75, null)[0].label).toBe("RSI élevé (75)");
    expect(technicalSignalSentences(100, null, null, 20, null)[0].label).toBe("RSI bas (20)");
    expect(technicalSignalSentences(100, null, null, 50, null)[0].label).toBe("RSI neutre (50)");
  });

  it("flags proximity to ATH above -10%, and distance below -85%, but stays silent in between", () => {
    expect(technicalSignalSentences(100, null, null, null, -5).map((l) => l.label)).toContain(
      "Proche de son plus haut historique"
    );
    const far = technicalSignalSentences(100, null, null, null, -90);
    expect(far.map((l) => l.label)).toContain("Très loin de son plus haut historique");
    expect(far[0].text).toContain("-90%");
    expect(technicalSignalSentences(100, null, null, null, -50)).toEqual([]);
  });
});

describe("detail.js — computeVolumeWindows", () => {
  const dom = loadPage(["prices.js", "detail.js"]);
  const { computeVolumeWindows } = dom.window;

  it("returns null on an empty/missing volume history", () => {
    expect(computeVolumeWindows(null)).toBeNull();
    expect(computeVolumeWindows([])).toBeNull();
  });

  it("computes vol24h and each average from the tail of the array, null below the window size", () => {
    // 10 jours de volume constant à 100, sauf le dernier jour (24h) à 200.
    const volumes = Array.from({ length: 10 }, () => 100);
    volumes[volumes.length - 1] = 200;
    const vw = computeVolumeWindows(volumes);
    expect(vw.vol24h).toBe(200);
    expect(vw.avg7d).toBeCloseTo((200 + 100 * 6) / 7, 6);
    expect(vw.avg14d).toBeNull(); // seulement 10 points, pas assez pour 14j
    expect(vw.avg30d).toBeNull();
  });
});

describe("detail.js — volumeTrendSignal", () => {
  const dom = loadPage(["prices.js", "detail.js"]);
  const { volumeTrendSignal } = dom.window;

  it("returns null without a usable 7d average", () => {
    expect(volumeTrendSignal(null, 100, 90)).toBeNull();
    expect(volumeTrendSignal({ vol24h: 100, avg7d: 0 }, 100, 90)).toBeNull();
  });

  it("reads a volume spike above an uptrending price as accumulation, not just noise", () => {
    const signal = volumeTrendSignal({ vol24h: 300, avg7d: 100 }, 110, 100); // prix > MM20
    expect(signal.label).toContain("×3.0");
    expect(signal.text).toContain("accumulation réelle");
  });

  it("reads a volume spike below a downtrending price as real selling pressure", () => {
    const signal = volumeTrendSignal({ vol24h: 300, avg7d: 100 }, 90, 100); // prix < MM20
    expect(signal.text).toContain("pression vendeuse");
  });

  it("flags a low-volume move as low-conviction, whichever direction the price takes", () => {
    const signal = volumeTrendSignal({ vol24h: 30, avg7d: 100 }, 110, 100);
    expect(signal.label).toContain("30 %");
    expect(signal.text).toContain("prudence");
  });

  it("treats volume within its normal range as unremarkable", () => {
    const signal = volumeTrendSignal({ vol24h: 110, avg7d: 100 }, 110, 100);
    expect(signal.text).toContain("fourchette normale");
  });
});

describe("detail.js — utilitySignal (FAVORIS[].utility, config.js)", () => {
  const dom = loadPage(["config.js", "prices.js", "detail.js"]);
  const { utilitySignal } = dom.window;

  it("returns the real, researched utility text for a tracked asset", () => {
    const signal = utilitySignal("chainlink");
    expect(signal.label).toBe("Utilité du token");
    expect(signal.text).toContain("oracle");
  });

  it("returns null for an asset outside FAVORIS rather than guessing", () => {
    expect(utilitySignal("some-untracked-coin")).toBeNull();
  });
});

describe("detail.js — renderOpportunityHorizonsSection", () => {
  const dom = loadPage(["prices.js", "detail.js"]);
  const { renderOpportunityHorizonsSection } = dom.window;

  it("returns an empty string when there are no horizons at all", () => {
    expect(renderOpportunityHorizonsSection(null)).toBe("");
  });

  it("shows 'en attente' for a pending horizon", () => {
    const html = renderOpportunityHorizonsSection({ j1: { status: "pending" } });
    expect(html).toContain("en attente");
    expect(html).toContain("badge-neutral");
  });

  it("shows a green validated badge with the signed move for a resolved+validated horizon", () => {
    const html = renderOpportunityHorizonsSection({ j7: { status: "resolved", outcome: { validated: true, move_pct: 12.34 } } });
    expect(html).toContain("badge-achat");
    expect(html).toContain("+12.3 %");
  });

  it("shows a red invalidated badge with the signed (negative) move for a resolved+invalidated horizon", () => {
    const html = renderOpportunityHorizonsSection({ j14: { status: "resolved", outcome: { validated: false, move_pct: -5.67 } } });
    expect(html).toContain("badge-vente");
    expect(html).toContain("-5.7 %");
  });

  it("silently skips a horizon key that is entirely absent from the data", () => {
    const html = renderOpportunityHorizonsSection({ j1: { status: "pending" } });
    // m6/j14/etc. absents : pas de crash, simplement pas de chip pour ces clés-là.
    expect(html).not.toContain("undefined");
  });
});
