import { describe, it, expect } from "vitest";
import { buildPriceAlerts } from "../scripts/price-alerts.mjs";

const now = new Date("2026-10-04T22:40:00Z");
const v = (over) => ({
  id: "v-20260928-inj", asset: "injective-protocol", ticker: "INJ", verdict: "ACHAT", status: "pending",
  issued_at: "2026-09-28T08:00:00Z", resolves_at: "2026-10-12T08:00:00Z", price_at_issue: 10, threshold_pct: 5, ...over,
});

describe("scripts/price-alerts.mjs — buildPriceAlerts", () => {
  it("emits one alert when the move since issue crosses the threshold, with the real numbers", () => {
    const [a] = buildPriceAlerts([v()], [], { "injective-protocol": 10.61 }, now);
    expect(a).toMatchObject({ type: "seuil_technique", ticker_ou_theme: "INJ", verdict_id: "v-20260928-inj", sentiment: "positif" });
    expect(a.message).toContain("+6,10 %");
    expect(a.message).toContain("10,00 € → 10,61 €");
    expect(a.message).toContain("dans le sens du verdict");
  });

  it("says when the move goes against the verdict", () => {
    const [a] = buildPriceAlerts([v()], [], { "injective-protocol": 9 }, now);
    expect(a.message).toContain("en sens opposé au verdict");
    expect(a.sentiment).toBe("négatif");
  });

  it("stays silent under the threshold", () => {
    expect(buildPriceAlerts([v()], [], { "injective-protocol": 10.4 }, now)).toEqual([]);
  });

  it("never alerts twice for the same verdict", () => {
    expect(buildPriceAlerts([v()], [{ id: "x", verdict_id: "v-20260928-inj" }], { "injective-protocol": 12 }, now)).toEqual([]);
  });

  it("ignores resolved or expired verdicts and missing prices (never guessed)", () => {
    expect(buildPriceAlerts([v({ status: "resolved" })], [], { "injective-protocol": 12 }, now)).toEqual([]);
    expect(buildPriceAlerts([v({ resolves_at: "2026-10-01T00:00:00Z" })], [], { "injective-protocol": 12 }, now)).toEqual([]);
    expect(buildPriceAlerts([v()], [], {}, now)).toEqual([]);
  });

  it("keeps ids unique (the Worker uses them to avoid duplicate pushes)", () => {
    const [a] = buildPriceAlerts([v()], [{ id: "alert-20261004-inj-seuil" }], { "injective-protocol": 12 }, now);
    expect(a.id).not.toBe("alert-20261004-inj-seuil");
  });

  it("caps a run at 3 alerts, biggest moves first (each alert is a push notification)", () => {
    const vs = ["a", "b", "c", "d"].map((t, i) => v({ id: "v-" + t, ticker: t.toUpperCase(), asset: t }));
    const out = buildPriceAlerts(vs, [], { a: 11, b: 14, c: 8, d: 12 }, now);
    expect(out.map((x) => x.ticker_ou_theme)).toEqual(["B", "C", "D"]);
  });

  it("formats small prices with their significant digits", () => {
    const [a] = buildPriceAlerts([v({ price_at_issue: 0.026474 })], [], { "injective-protocol": 0.028 }, now);
    expect(a.message).toContain("0,026474 € → 0,028 €");
  });
});
