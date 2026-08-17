import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

describe("cards.js — computeConfidence", () => {
  const dom = loadPage(["prices.js", "cards.js"]);
  const { computeConfidence } = dom.window;

  it("starts at a base of 40 with no signals", () => {
    expect(computeConfidence({})).toBe(40);
  });

  it("adds 30 for a top-100 market cap rank", () => {
    expect(computeConfidence({ market_cap_rank: 50 })).toBe(70);
    expect(computeConfidence({ market_cap_rank: 100 })).toBe(70); // borne incluse
    expect(computeConfidence({ market_cap_rank: 101 })).toBe(40); // juste au-dessus, rien
  });

  it("adds 20 when recognized", () => {
    expect(computeConfidence({ recognized: true })).toBe(60);
  });

  it("adds 10 when the 7-day move is under 30% in absolute value", () => {
    expect(computeConfidence({ change_7d_pct: 10 })).toBe(50);
    expect(computeConfidence({ change_7d_pct: -29.9 })).toBe(50);
  });

  it("does not add the volatility bonus for a move of 30% or more (either direction)", () => {
    expect(computeConfidence({ change_7d_pct: 30 })).toBe(40);
    expect(computeConfidence({ change_7d_pct: -50 })).toBe(40);
  });

  it("does not crash when change_7d_pct is missing (Math.abs(undefined) is NaN, comparison is just false)", () => {
    expect(computeConfidence({ market_cap_rank: 10 })).toBe(70);
  });

  it("caps the total at 95 even when every bonus applies", () => {
    expect(computeConfidence({ market_cap_rank: 1, recognized: true, change_7d_pct: 5 })).toBe(95);
  });
});

describe("cards.js — sparklinePoints", () => {
  const dom = loadPage(["prices.js", "cards.js"]);
  const { sparklinePoints } = dom.window;

  it("returns an empty string for missing/short series", () => {
    expect(sparklinePoints(null, 100, 32)).toBe("");
    expect(sparklinePoints(undefined, 100, 32)).toBe("");
    expect(sparklinePoints([], 100, 32)).toBe("");
    expect(sparklinePoints([1], 100, 32)).toBe("");
  });

  it("maps a rising 2-point series to opposite corners", () => {
    // min=0, max=10 sur une largeur 100 / hauteur 32 : le point bas (valeur min) est en
    // bas du SVG (y=h), le point haut (valeur max) est en haut (y=0).
    expect(sparklinePoints([0, 10], 100, 32)).toBe("0.0,32.0 100.0,0.0");
  });

  it("does not divide by zero on a perfectly flat series (range=0 falls back to 1)", () => {
    expect(sparklinePoints([5, 5, 5], 100, 32)).toBe("0.0,32.0 50.0,32.0 100.0,32.0");
  });
});

describe("cards.js — formatMarketCap", () => {
  const dom = loadPage(["prices.js", "cards.js"]);
  const { formatMarketCap, formatPrice } = dom.window;

  it("returns an em dash for null/undefined", () => {
    expect(formatMarketCap(null)).toBe("—");
    expect(formatMarketCap(undefined)).toBe("—");
  });

  it("formats billions as 'Md€' from 1e9 up", () => {
    expect(formatMarketCap(2.5e9)).toBe("2.50 Md€");
    expect(formatMarketCap(1e9)).toBe("1.00 Md€");
  });

  it("formats millions as 'M€' from 1e6 up to (not including) 1e9", () => {
    expect(formatMarketCap(3.456e6)).toBe("3.5 M€");
    expect(formatMarketCap(999999999)).toBe("1000.0 M€"); // juste sous 1e9 : reste en M€, arrondi affiché à 1000.0
  });

  it("falls back to formatPrice under 1e6", () => {
    expect(formatMarketCap(500000)).toBe(formatPrice(500000, "EUR"));
  });
});
