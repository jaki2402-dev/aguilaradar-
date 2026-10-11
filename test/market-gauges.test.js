import { describe, it, expect } from "vitest";
import { parseFearGreed, parseGlobal, parseGoldTokens } from "../scripts/market-gauges.mjs";

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

  // Prix réels relevés le 10/10/2026 via CoinGecko : PAXG 4183,38 $, XAUT 4181,51 $.
  it("moyenne les deux jetons adossés à l'or quand ils concordent", () => {
    const gold = parseGoldTokens({ "pax-gold": { usd: 4183.38, last_updated_at: 1791670000 }, "tether-gold": { usd: 4181.51, last_updated_at: 1791669000 } });
    expect(gold).toMatchObject({ usd_per_oz: 4182.45, spread_pct: 0.04 });
    expect(gold.as_of).toBe(new Date(1791669000 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")); // le plus ancien des deux relevés
    expect(gold.source).toContain("approximation");
  });

  it("n'écrit rien si un jeton manque ou si les deux divergent de plus de 2 %", () => {
    expect(parseGoldTokens({ "pax-gold": { usd: 4183 } })).toBeNull();
    expect(parseGoldTokens({ "pax-gold": { usd: 4183 }, "tether-gold": { usd: 0 } })).toBeNull();
    expect(parseGoldTokens({ "pax-gold": { usd: 4183 }, "tether-gold": { usd: 4000 } })).toBeNull(); // ~4,5 % d'écart
    expect(parseGoldTokens(null)).toBeNull();
  });
});

describe("scripts/market-gauges.mjs — taux 10 ans (FRED) et stablecoins (DefiLlama)", async () => {
  const { parseFredCsv, parseStablecoinChart } = await import("../scripts/market-gauges.mjs");

  it("FRED : dernière séance chiffrée, jours fériés (« . ») ignorés", () => {
    const csv = "observation_date,DGS10\n2026-10-07,4.11\n2026-10-08,4.14\n2026-10-09,.\n";
    expect(parseFredCsv(csv)).toMatchObject({ pct: 4.14, date: "2026-10-08" });
    expect(parseFredCsv("DATE,DGS10\r\n2026-10-08,4.14\r\n")).toMatchObject({ pct: 4.14 });
    expect(parseFredCsv("<html>erreur</html>")).toBeNull();
    expect(parseFredCsv("observation_date,DGS10\n2026-10-08,.\n")).toBeNull();
  });

  it("DefiLlama : total du dernier jour et évolution sur 7 jours", () => {
    const day = (i, v) => ({ date: String(1791158400 + i * 86400), totalCirculatingUSD: { peggedUSD: v } });
    const body = Array.from({ length: 10 }, (_, i) => day(i, 280e9 + i * 1e9));
    expect(parseStablecoinChart(body)).toMatchObject({ total_usd: 289e9, change_7d_pct: 2.48 });
    expect(parseStablecoinChart(body.slice(0, 5))).toBeNull();
    expect(parseStablecoinChart([{ date: "1" }])).toBeNull();
  });
});
