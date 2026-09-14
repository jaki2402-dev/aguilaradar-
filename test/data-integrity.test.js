import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

describe("data-integrity.js — freshnessStatusForDate", () => {
  const dom = loadPage(["data-integrity.js"]);
  const { freshnessStatusForDate } = dom.window;

  it("returns null for a missing or invalid date", () => {
    expect(freshnessStatusForDate(null)).toBeNull();
    expect(freshnessStatusForDate(undefined)).toBeNull();
    expect(freshnessStatusForDate("pas une date")).toBeNull();
  });

  it("classifies a recent timestamp as ok", () => {
    const r = freshnessStatusForDate(daysAgo(1));
    expect(r.status).toBe("ok");
    expect(r.ageDays).toBeGreaterThanOrEqual(0);
  });

  it("classifies a timestamp past warnDays but before staleDays as warning", () => {
    expect(freshnessStatusForDate(daysAgo(15)).status).toBe("warning");
  });

  it("classifies a timestamp past staleDays as stale", () => {
    expect(freshnessStatusForDate(daysAgo(30)).status).toBe("stale");
  });

  it("respects custom warnDays/staleDays", () => {
    expect(freshnessStatusForDate(daysAgo(3), { warnDays: 1, staleDays: 5 }).status).toBe("warning");
    expect(freshnessStatusForDate(daysAgo(10), { warnDays: 1, staleDays: 5 }).status).toBe("stale");
  });
});

describe("data-integrity.js — checkFavorisContextFreshness", () => {
  const dom = loadPage(["data-integrity.js"]);
  const { checkFavorisContextFreshness } = dom.window;

  it("returns [] when favorisContext is missing or has no assets", () => {
    expect(checkFavorisContextFreshness(null)).toEqual([]);
    expect(checkFavorisContextFreshness({})).toEqual([]);
  });

  it("evaluates each asset independently against its own last_computed_at", () => {
    const favorisContext = {
      assets: {
        BTC: { last_computed_at: daysAgo(1) },
        LINK: { last_computed_at: daysAgo(30) },
        ETH: {}, // pas de last_computed_at -> jamais calculé, pas "périmé"
      },
    };
    const result = checkFavorisContextFreshness(favorisContext);
    expect(result).toHaveLength(2); // ETH exclu, jamais "jamais calculé" == "périmé"
    const byTicker = Object.fromEntries(result.map((r) => [r.ticker, r.status]));
    expect(byTicker.BTC).toBe("ok");
    expect(byTicker.LINK).toBe("stale");
  });
});

describe("data-integrity.js — checkVerdictPlausibility", () => {
  const dom = loadPage(["data-integrity.js"]);
  const { checkVerdictPlausibility } = dom.window;

  it("returns [] for an empty or well-formed list", () => {
    expect(checkVerdictPlausibility([])).toEqual([]);
    expect(checkVerdictPlausibility(undefined)).toEqual([]);
    expect(
      checkVerdictPlausibility([{ id: "v1", ticker: "BTC", confidence_pct: 60, horizon_days: 14, price_at_issue: 55000 }])
    ).toEqual([]);
  });

  it("flags confidence_pct outside 0-100", () => {
    const issues = checkVerdictPlausibility([{ id: "v1", confidence_pct: 140 }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("confidence_pct");
  });

  it("flags a negative confidence_pct too, not just above 100", () => {
    expect(checkVerdictPlausibility([{ id: "v1", confidence_pct: -5 }])).toHaveLength(1);
  });

  it("flags horizon_days <= 0", () => {
    expect(checkVerdictPlausibility([{ id: "v1", horizon_days: 0 }])[0].field).toBe("horizon_days");
    expect(checkVerdictPlausibility([{ id: "v1", horizon_days: -3 }])[0].field).toBe("horizon_days");
  });

  it("flags price_at_issue <= 0", () => {
    expect(checkVerdictPlausibility([{ id: "v1", price_at_issue: 0 }])[0].field).toBe("price_at_issue");
  });

  it("never flags a field that is simply absent (not every verdict has every field)", () => {
    expect(checkVerdictPlausibility([{ id: "v1" }])).toEqual([]);
  });

  it("can report multiple independent issues on the same verdict", () => {
    expect(checkVerdictPlausibility([{ id: "v1", confidence_pct: 200, horizon_days: -1 }])).toHaveLength(2);
  });
});

describe("data-integrity.js — summarizeDataIntegrity", () => {
  const dom = loadPage(["data-integrity.js"]);
  const { summarizeDataIntegrity } = dom.window;

  it("reports zero issues when everything is fresh and plausible", () => {
    const favorisContext = { assets: { BTC: { last_computed_at: daysAgo(0) } } };
    const verdicts = [{ id: "v1", confidence_pct: 50 }];
    const summary = summarizeDataIntegrity(favorisContext, verdicts);
    expect(summary.totalIssues).toBe(0);
    expect(summary.staleFavoris).toEqual([]);
    expect(summary.plausibilityIssues).toEqual([]);
  });

  it("excludes ok-status favoris from staleFavoris but counts warning/stale ones", () => {
    const favorisContext = {
      assets: {
        BTC: { last_computed_at: daysAgo(0) },
        LINK: { last_computed_at: daysAgo(30) },
      },
    };
    const summary = summarizeDataIntegrity(favorisContext, []);
    expect(summary.staleFavoris).toHaveLength(1);
    expect(summary.staleFavoris[0].ticker).toBe("LINK");
    expect(summary.totalIssues).toBe(1);
  });

  it("sums stale favoris and plausibility issues into totalIssues", () => {
    const favorisContext = { assets: { LINK: { last_computed_at: daysAgo(30) } } };
    const verdicts = [{ id: "v1", confidence_pct: 200 }];
    expect(summarizeDataIntegrity(favorisContext, verdicts).totalIssues).toBe(2);
  });

  it("never throws on missing arguments", () => {
    expect(() => summarizeDataIntegrity(undefined, undefined)).not.toThrow();
  });
});
