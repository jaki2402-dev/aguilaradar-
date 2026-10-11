import { describe, it, expect } from "vitest";
import { buildPriceAlerts, issueCurrency } from "../scripts/price-alerts.mjs";

const now = new Date("2026-10-04T22:40:00Z");
const v = (over) => ({
  id: "v-20260928-inj", asset: "injective-protocol", ticker: "INJ", verdict: "ACHAT", status: "pending",
  issued_at: "2026-09-28T08:00:00Z", resolves_at: "2026-10-12T08:00:00Z", price_at_issue: 10, threshold_pct: 5, currency: "EUR", ...over,
});

describe("scripts/price-alerts.mjs — buildPriceAlerts", () => {
  it("emits one alert when the move since issue crosses the threshold, with the real numbers", () => {
    const [a] = buildPriceAlerts([v()], [], { eur: { "injective-protocol": 10.61 } }, now);
    expect(a).toMatchObject({ type: "seuil_technique", ticker_ou_theme: "INJ", verdict_id: "v-20260928-inj", sentiment: "positif" });
    expect(a.message).toContain("+6,10 %");
    expect(a.message).toContain("10,00 € → 10,61 €");
    expect(a.message).toContain("dans le sens du verdict");
  });

  it("says when the move goes against the verdict", () => {
    const [a] = buildPriceAlerts([v()], [], { eur: { "injective-protocol": 9 } }, now);
    expect(a.message).toContain("en sens opposé au verdict");
    expect(a.sentiment).toBe("négatif");
  });

  it("stays silent under the threshold", () => {
    expect(buildPriceAlerts([v()], [], { eur: { "injective-protocol": 10.4 } }, now)).toEqual([]);
  });

  it("never alerts twice for the same verdict", () => {
    expect(buildPriceAlerts([v()], [{ id: "x", verdict_id: "v-20260928-inj" }], { eur: { "injective-protocol": 12 } }, now)).toEqual([]);
  });

  it("ignores resolved or expired verdicts and missing prices (never guessed)", () => {
    expect(buildPriceAlerts([v({ status: "resolved" })], [], { eur: { "injective-protocol": 12 } }, now)).toEqual([]);
    expect(buildPriceAlerts([v({ resolves_at: "2026-10-01T00:00:00Z" })], [], { eur: { "injective-protocol": 12 } }, now)).toEqual([]);
    expect(buildPriceAlerts([v()], [], { eur: {} }, now)).toEqual([]);
  });

  it("keeps ids unique (the Worker uses them to avoid duplicate pushes)", () => {
    const [a] = buildPriceAlerts([v()], [{ id: "alert-20261004-inj-seuil" }], { eur: { "injective-protocol": 12 } }, now);
    expect(a.id).not.toBe("alert-20261004-inj-seuil");
  });

  it("caps a run at 3 alerts, biggest moves first (each alert is a push notification)", () => {
    const vs = ["a", "b", "c", "d"].map((t) => v({ id: "v-" + t, ticker: t.toUpperCase(), asset: t }));
    const out = buildPriceAlerts(vs, [], { eur: { a: 11, b: 14, c: 8, d: 12 } }, now);
    expect(out.map((x) => x.ticker_ou_theme)).toEqual(["B", "C", "D"]);
  });

  it("formats small prices with their significant digits", () => {
    const [a] = buildPriceAlerts([v({ price_at_issue: 0.026474 })], [], { eur: { "injective-protocol": 0.028 } }, now);
    expect(a.message).toContain("0,026474 € → 0,028 €");
  });

  it("uses the verdict's currency (field first, else the table verified on real CoinGecko history)", () => {
    expect(issueCurrency(v({ currency: "USD", issued_at: "2026-09-01T00:00:00Z" }))).toBe("usd");
    expect(issueCurrency(v({ currency: undefined, issued_at: "2026-09-28T00:20:00Z" }))).toBe("usd");
    expect(issueCurrency(v({ currency: undefined, issued_at: "2026-09-13T23:26:00Z" }))).toBe("eur");
    expect(issueCurrency(v({ currency: undefined, asset: "cartesi", issued_at: "2026-10-03T07:18:00Z" }))).toBe("eur");
    const usd = v({ price_at_issue: 0.03521363, currency: undefined });
    const [a] = buildPriceAlerts([usd], [], { eur: { "injective-protocol": 0.0256 }, usd: { "injective-protocol": 0.0288 } }, now);
    expect(a.message).toContain("-18,21 %");
    expect(a.message).toContain("$");
  });

  it("skips a verdict whose currency cannot be established (never guessed)", () => {
    expect(issueCurrency(v({ currency: undefined, issued_at: undefined }))).toBe(null);
    expect(buildPriceAlerts([v({ currency: undefined, issued_at: undefined })], [], { eur: { "injective-protocol": 20 }, usd: { "injective-protocol": 20 } }, now)).toEqual([]);
  });

  // Régression (trouvé le 09/10/2026, confirmé sur 21/97 alertes réelles de data/alerts.json) :
  // `source` était bâti avec des guillemets normaux au lieu de backticks — ${cur.toUpperCase()}
  // ne s'interpolait jamais et s'affichait tel quel sur l'onglet Alertes.
  it("actually interpolates the currency into source (not a literal ${...})", () => {
    const [a] = buildPriceAlerts([v()], [], { eur: { "injective-protocol": 10.61 } }, now);
    expect(a.source).not.toContain("${");
    expect(a.source).toContain("EUR");
  });
});
