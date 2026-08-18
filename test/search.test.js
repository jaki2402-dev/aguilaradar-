import { describe, it, expect, beforeEach } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

describe("search.js — findLatestVerdict", () => {
  const dom = loadPage(["search.js"]);
  const { findLatestVerdict } = dom.window;

  it("picks the most recent verdict by issued_at, even when the input is not already sorted", () => {
    const verdicts = [
      { asset: "bitcoin", issued_at: "2026-08-01T00:00:00Z", verdict: "ATTENTE" },
      { asset: "bitcoin", issued_at: "2026-08-10T00:00:00Z", verdict: "VENTE" }, // le plus recent, pas le dernier du tableau
      { asset: "bitcoin", issued_at: "2026-08-05T00:00:00Z", verdict: "ACHAT" },
      { asset: "ethereum", issued_at: "2026-08-15T00:00:00Z", verdict: "ACHAT" },
    ];
    expect(findLatestVerdict(verdicts, "bitcoin").verdict).toBe("VENTE");
  });

  it("returns null when no verdict matches the given asset", () => {
    const verdicts = [{ asset: "bitcoin", issued_at: "2026-08-01T00:00:00Z" }];
    expect(findLatestVerdict(verdicts, "ethereum")).toBeNull();
  });

  it("is null-safe on a missing verdicts array", () => {
    expect(findLatestVerdict(null, "bitcoin")).toBeNull();
    expect(findLatestVerdict(undefined, "bitcoin")).toBeNull();
    expect(findLatestVerdict([], "bitcoin")).toBeNull();
  });
});

describe("search.js — findOpportunity", () => {
  const dom = loadPage(["search.js"]);
  const { findOpportunity } = dom.window;

  it("finds an opportunity by cgId", () => {
    const data = { opportunities: [{ cgId: "cardano", ticker: "ADA" }, { cgId: "solana", ticker: "SOL" }] };
    expect(findOpportunity(data, "solana").ticker).toBe("SOL");
  });

  it("returns null when nothing matches", () => {
    const data = { opportunities: [{ cgId: "cardano", ticker: "ADA" }] };
    expect(findOpportunity(data, "solana")).toBeNull();
  });

  it("is null-safe on missing opportunitiesData or a missing/empty opportunities array", () => {
    expect(findOpportunity(null, "cardano")).toBeNull();
    expect(findOpportunity({}, "cardano")).toBeNull();
    expect(findOpportunity({ opportunities: [] }, "cardano")).toBeNull();
  });
});

const SEARCH_FIXTURE_HTML = `<!doctype html><html><body>
  <form id="search-form"><input id="search-input" /></form>
  <div id="search-result"></div>
</body></html>`;

// Ordre index.html : config, prices, charts (mountTradingViewChart, no-op sans window.TradingView
// réel), cards (renderOpportunityCard), detail (attachDetailToggle), app (loadJson/DATA_URLS), search.
function loadSearchPage() {
  return loadPage(["config.js", "prices.js", "charts.js", "cards.js", "detail.js", "app.js", "search.js"], {
    html: SEARCH_FIXTURE_HTML,
  });
}

describe("search.js — renderTrackedVerdictResult (actif suivi avec verdict du moteur)", () => {
  let dom;
  const coin = {
    symbol: "btc",
    name: "Bitcoin",
    current_price: 55000,
    price_change_percentage_24h_in_currency: 2.5,
    price_change_percentage_7d_in_currency: -1.2,
    price_change_percentage_30d_in_currency: 10,
    market_cap_rank: 1,
  };
  const verdict = {
    asset: "bitcoin",
    verdict: "ACHAT",
    reasoning: "RSI bas, MM20 > MM50",
    confidence_pct: 72,
    horizon_days: 14,
    status: "pending",
  };

  beforeEach(() => {
    dom = loadSearchPage();
  });

  it("renders ticker (uppercased), name, verdict badge and reasoning", () => {
    dom.window.renderTrackedVerdictResult(coin, verdict);
    const el = dom.window.document.getElementById("search-result");
    expect(el.querySelector(".favori-ticker").textContent).toBe("BTC");
    expect(el.querySelector(".favori-name").textContent).toBe("Bitcoin");
    expect(el.querySelector(".badge").textContent).toBe("ACHAT");
    expect(el.querySelector(".badge").className).toBe("badge badge-achat");
    expect(el.textContent).toContain("RSI bas, MM20 > MM50");
  });

  it("escapes name and reasoning before inserting them (trust boundary — CoinGecko name / verdict reasoning)", () => {
    dom.window.renderTrackedVerdictResult(
      { ...coin, name: "<b>Bitcoin</b>" },
      { ...verdict, reasoning: "<img src=x onerror=alert(1)>" }
    );
    const el = dom.window.document.getElementById("search-result");
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<b>Bitcoin</b>");
    expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("wires the card to attachDetailToggle when it is available (keyboard-clickable)", () => {
    dom.window.renderTrackedVerdictResult(coin, verdict);
    const card = dom.window.document.querySelector("#search-result .favori-card.clickable");
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");
  });

  it("does not throw when attachDetailToggle is unavailable (detail.js not loaded, guarded by window.attachDetailToggle)", () => {
    const bareDom = loadPage(["config.js", "prices.js", "charts.js", "app.js", "search.js"], { html: SEARCH_FIXTURE_HTML });
    expect(() => bareDom.window.renderTrackedVerdictResult(coin, verdict)).not.toThrow();
  });
});

describe("search.js — renderTrackedOpportunityResult (actif suivi via le criblage Top 300)", () => {
  let dom;
  const opportunity = {
    id: "opp-ada",
    ticker: "ADA",
    name: "Cardano",
    cgId: "cardano",
    price_eur: 0.5,
    change_24h_pct: 1,
    change_7d_pct: 2,
    change_30d_pct: 3,
    market_cap: 1e10,
    reason: "Momentum haussier",
  };

  beforeEach(() => {
    dom = loadSearchPage();
  });

  it("renders the opportunity card and the 'already tracked' hint", () => {
    dom.window.renderTrackedOpportunityResult(opportunity);
    const el = dom.window.document.getElementById("search-result");
    expect(el.querySelector(".opp-card")).not.toBeNull();
    expect(el.textContent).toContain("ADA");
    expect(el.textContent).toContain("criblage Top 300");
  });

  it("wires the card to attachDetailToggle when available", () => {
    dom.window.renderTrackedOpportunityResult(opportunity);
    const card = dom.window.document.querySelector("#search-result .opp-card.clickable");
    expect(card.getAttribute("role")).toBe("button");
  });
});

describe("search.js — renderUntrackedResult (actif hors radar, fiche d'identité factuelle)", () => {
  let dom;
  const coin = {
    id: "some-coin",
    symbol: "xyz",
    name: "SomeCoin",
    current_price: 1.23,
    price_change_percentage_24h_in_currency: -3,
    price_change_percentage_7d_in_currency: 5,
    price_change_percentage_30d_in_currency: -10,
    market_cap_rank: 250,
  };

  beforeEach(() => {
    dom = loadSearchPage();
  });

  it("renders the base price card immediately and shows 'not tracked by the engine'", async () => {
    dom.window.fetch = async () => ({ ok: true, json: async () => ({}) });
    await dom.window.renderUntrackedResult(coin);
    const el = dom.window.document.getElementById("search-result");
    expect(el.querySelector(".favori-ticker").textContent).toBe("XYZ");
    expect(el.textContent).toContain("Non suivi par le moteur");
  });

  it("escapes the description, tags and links it fills in from CoinGecko (trust boundary — public API, untrusted)", async () => {
    dom.window.fetch = async () => ({
      ok: true,
      json: async () => ({
        description: { fr: "<b>Texte</b> avec balise\nDeuxième ligne" },
        categories: ["<i>DeFi</i>", "Layer 1"],
        links: { homepage: ["https://example.com/xyz"] },
      }),
    });
    await dom.window.renderUntrackedResult(coin);
    const el = dom.window.document.getElementById("search-fiche-identite");
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector("i")).toBeNull();
    expect(el.textContent).toContain("<b>Texte</b>");
    expect(el.textContent).toContain("<i>DeFi</i>");
    const link = el.querySelector("a");
    expect(link.getAttribute("href")).toBe("https://example.com/xyz");
  });

  it("drops a javascript: homepage link instead of rendering it (safeUrl)", async () => {
    dom.window.fetch = async () => ({
      ok: true,
      json: async () => ({ description: {}, categories: [], links: { homepage: ["javascript:alert(1)"] } }),
    });
    await dom.window.renderUntrackedResult(coin);
    expect(dom.window.document.getElementById("search-fiche-identite").querySelector("a")).toBeNull();
  });

  it("leaves the identity card section empty (not stuck on 'loading') when the info fetch fails", async () => {
    dom.window.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await dom.window.renderUntrackedResult(coin);
    expect(dom.window.document.getElementById("search-fiche-identite").innerHTML).toBe("");
  });
});

describe("search.js — handleSearchSubmit (orchestration : verdict > opportunité > non suivi)", () => {
  let dom;

  function stubFetch({ coins = [{ id: "bitcoin" }], markets = { id: "bitcoin", symbol: "btc", name: "Bitcoin" }, verdicts = [], opportunities = { opportunities: [] }, fullInfo = {} } = {}) {
    dom.window.fetch = async (url) => {
      const ok = (body) => ({ ok: true, json: async () => body });
      if (url.includes("/api/v3/search?query=")) return ok({ coins });
      if (url.includes("/coins/markets")) return ok(markets ? [markets] : []);
      if (url.includes("data/verdicts.json")) return ok(verdicts);
      if (url.includes("data/opportunities.json")) return ok(opportunities);
      if (url.includes("/api/v3/coins/")) return ok(fullInfo);
      return { ok: false, status: 404, json: async () => ({}) };
    };
  }

  beforeEach(() => {
    dom = loadSearchPage();
  });

  it("shows an escaped 'no result' message when CoinGecko finds nothing", async () => {
    stubFetch({ coins: [] });
    await dom.window.handleSearchSubmit("<b>zzz</b>");
    const el = dom.window.document.getElementById("search-result");
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toContain("<b>zzz</b>");
  });

  it("routes to the tracked-verdict view when a verdict exists for the matched coin", async () => {
    stubFetch({
      markets: { id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 50000 },
      verdicts: [{ asset: "bitcoin", verdict: "VENTE", reasoning: "x", issued_at: "2026-08-17T00:00:00Z" }],
      opportunities: { opportunities: [{ cgId: "bitcoin", ticker: "BTC" }] }, // présent aussi côté opportunités : le verdict doit gagner
    });
    await dom.window.handleSearchSubmit("bitcoin");
    const el = dom.window.document.getElementById("search-result");
    expect(el.querySelector(".favori-card")).not.toBeNull();
    expect(el.querySelector(".badge").textContent).toBe("VENTE");
  });

  it("routes to the tracked-opportunity view when there is no verdict but the coin is in the Top 300 screening", async () => {
    stubFetch({
      markets: { id: "bitcoin", symbol: "btc", name: "Bitcoin" },
      verdicts: [],
      opportunities: { opportunities: [{ cgId: "bitcoin", ticker: "BTC", name: "Bitcoin" }] },
    });
    await dom.window.handleSearchSubmit("bitcoin");
    expect(dom.window.document.querySelector("#search-result .opp-card")).not.toBeNull();
  });

  it("routes to the untracked view when the coin has neither a verdict nor a screened opportunity", async () => {
    stubFetch({ markets: { id: "bitcoin", symbol: "btc", name: "Bitcoin" }, verdicts: [], opportunities: { opportunities: [] } });
    await dom.window.handleSearchSubmit("bitcoin");
    expect(dom.window.document.getElementById("search-result").textContent).toContain("Non suivi par le moteur");
  });

  it("shows a graceful, non-throwing error message on a network failure", async () => {
    dom.window.fetch = async () => { throw new Error("offline"); };
    await expect(dom.window.handleSearchSubmit("bitcoin")).resolves.not.toThrow();
    expect(dom.window.document.getElementById("search-result").textContent).toContain("Recherche indisponible");
  });

  it("does nothing for an empty or whitespace-only query", async () => {
    let fetchCalled = false;
    dom.window.fetch = async () => { fetchCalled = true; throw new Error("ne devrait jamais être appelé"); };
    await dom.window.handleSearchSubmit("   ");
    expect(fetchCalled).toBe(false);
  });
});
