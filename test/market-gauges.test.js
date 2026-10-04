import { describe, it, expect } from "vitest";
import { parseFearGreed, parseGlobal } from "../scripts/market-gauges.mjs";

describe("scripts/market-gauges.mjs", () => {
  it("parses the alternative.me Fear & Greed payload", () => {
    const fg = parseFearGreed({ data: [{ value: "47", value_classification: "Neutral", timestamp: "1791158400" }] });
    expect(fg).toMatchObject({ value: 47, classification: "Neutral" });
    expect(fg.as_of).toMatch(/^2026-10-05T/);
  });

  it("parses BTC dominance from CoinGecko /global", () => {
    expect(parseGlobal({ data: { market_cap_percentage: { btc: 58.6123 }, updated_at: 1791158400 } })).toMatchObject({ pct: 58.61 });
  });

  it("rejects malformed or out-of-range answers instead of writing a wrong number", () => {
    expect(parseFearGreed({ data: [] })).toBeNull();
    expect(parseFearGreed({ data: [{ value: "150", timestamp: "1" }] })).toBeNull();
    expect(parseGlobal({ data: {} })).toBeNull();
    expect(parseGlobal(null)).toBeNull();
  });
});
