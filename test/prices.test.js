import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

// L'affichage "fr-FR" d'Intl.NumberFormat utilise des espaces spéciales invisibles
// (U+00A0 avant €, U+202F comme séparateur de milliers) — jamais fiable à retaper à la
// main dans un test (vérifié : ce ne sont PAS des espaces ASCII normales). On calcule donc
// la chaîne attendue avec le même appel Intl plutôt que de la deviner.
function expectedFrEur(value, decimals) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

describe("prices.js — formatPrice", () => {
  const dom = loadPage(["prices.js"]);
  const { formatPrice } = dom.window;

  it("returns an em dash for null/undefined", () => {
    expect(formatPrice(null, "EUR")).toBe("—");
    expect(formatPrice(undefined, "EUR")).toBe("—");
  });

  it("uses 4 decimals under 1", () => {
    expect(formatPrice(0.5, "EUR")).toBe(expectedFrEur(0.5, 4));
  });

  it("uses 3 decimals from 1 up to (not including) 100", () => {
    expect(formatPrice(1, "EUR")).toBe(expectedFrEur(1, 3));
    expect(formatPrice(99.999, "EUR")).toBe(expectedFrEur(99.999, 3));
  });

  it("uses 2 decimals at 100 and above", () => {
    expect(formatPrice(100, "EUR")).toBe(expectedFrEur(100, 2));
    expect(formatPrice(60000, "EUR")).toBe(expectedFrEur(60000, 2));
  });

  it("picks the decimal count from the pre-rounding value, not the displayed one", () => {
    // 0.999999 < 1 => 4 decimales choisies AVANT arrondi, meme si l'affichage arrondi
    // (0,9999996 -> "1,0000 €") ressemble ensuite a un nombre >= 1. Piège réel si on
    // réordonnait le code pour arrondir avant de choisir le nombre de décimales.
    expect(formatPrice(0.999999, "EUR")).toBe(expectedFrEur(0.999999, 4));
    expect(formatPrice(0.999999, "EUR")).toContain("1,0000");
  });

  it("contains the euro sign", () => {
    expect(formatPrice(42, "EUR")).toContain("€");
  });
});

describe("prices.js — formatChangePct", () => {
  const dom = loadPage(["prices.js"]);
  const { formatChangePct } = dom.window;

  it("returns an em dash for null/undefined", () => {
    expect(formatChangePct(null)).toBe("—");
    expect(formatChangePct(undefined)).toBe("—");
  });

  it("formats a positive change with an up arrow and explicit plus sign", () => {
    expect(formatChangePct(3.14159)).toBe("▲ +3.14 %");
  });

  it("formats a negative change with a down arrow", () => {
    expect(formatChangePct(-2.5)).toBe("▼ -2.50 %");
  });

  it("treats exactly zero as the positive/up branch", () => {
    expect(formatChangePct(0)).toBe("▲ +0.00 %");
  });
});
