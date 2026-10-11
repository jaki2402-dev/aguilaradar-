import { describe, it, expect } from "vitest";
import { parseCmcQuotes, crossCheck } from "../scripts/cmc-crosscheck.mjs";

// Forme documentée de /v1/cryptocurrency/quotes/latest ; valeurs = relevé réel du connecteur
// CoinMarketCap le 11/10/2026 à 09h31 UTC (BTC, JUP, INJ).
const BODY = {
  data: {
    1: { circulating_supply: 20096531, max_supply: 21000000, quote: { USD: { price: 82955.67, market_cap: 1667121228270.3, fully_diluted_market_cap: 1742069106040.06 } } },
    29210: { circulating_supply: 3319369204.37, max_supply: 6862435229.58, quote: { USD: { price: 0.3606, market_cap: 1196956587.63, fully_diluted_market_cap: 2474577713.26 } } },
    7226: { circulating_supply: 99970954.5, max_supply: 100000000, quote: { USD: { price: 7.593, market_cap: 759105723.46, fully_diluted_market_cap: 759326273.58 } } },
  },
};

describe("recoupement CoinGecko ↔ CoinMarketCap", () => {
  it("lit la réponse de l'API (ids vérifiés → tickers)", () => {
    const m = parseCmcQuotes(BODY);
    expect(Object.keys(m)).toEqual(["BTC", "JUP", "INJ"]);
    expect(m.JUP).toMatchObject({ price_usd: 0.3606, max_supply: 6862435229.58 });
    expect(parseCmcQuotes(null)).toEqual({});
  });

  it("signale les vrais écarts du 11/10 : offre max de JUP et d'INJ, pas le cours du BTC", () => {
    const robot = {
      BTC: { price_usd: 82959.2, supply: { circulating_supply: 20096500, max_supply: 21000000 } },
      JUP: { price_usd: 0.359167, supply: { circulating_supply: 3319000000, max_supply: 10000000000 } },
      INJ: { price_usd: 7.71069, supply: { circulating_supply: 99970954, max_supply: null } },
    };
    const c = crossCheck(robot, parseCmcQuotes(BODY));
    expect(c.BTC).toMatchObject({ agreed: true, price_gap_pct: 0 });
    expect(c.JUP.agreed).toBe(false);
    expect(c.JUP.notes[0]).toContain("offre maximale");
    expect(c.INJ.notes).toEqual(["offre maximale : non plafonnée (CoinGecko) contre 100000000 (CoinMarketCap)"]);
  });
});
