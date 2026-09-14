import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

function loadOnchainPage() {
  return loadPage(["config.js", "cards.js", "onchain.js"]);
}

describe("onchain.js — fetchBtcTvlLive", () => {
  it("parses the last point of the DefiLlama historical TVL array", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async () => ({ ok: true, json: async () => [{ date: 1, tvl: 100 }, { date: 2, tvl: 4180000000 }] });
    const r = await dom.window.fetchBtcTvlLive();
    expect(r).toEqual({ valueUsd: 4180000000, source: "DefiLlama" });
  });

  it("returns null on a non-ok response", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async () => ({ ok: false, status: 500 });
    expect(await dom.window.fetchBtcTvlLive()).toBeNull();
  });

  it("returns null (not throws) on an empty or malformed array", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async () => ({ ok: true, json: async () => [] });
    expect(await dom.window.fetchBtcTvlLive()).toBeNull();
  });

  it("returns null when the response isn't an array at all (API shape changed)", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async () => ({ ok: true, json: async () => ({ tvl: 123 }) });
    expect(await dom.window.fetchBtcTvlLive()).toBeNull();
  });

  it("returns null (not throws) on a network failure", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async () => { throw new Error("offline"); };
    await expect(dom.window.fetchBtcTvlLive()).resolves.toBeNull();
  });
});

describe("onchain.js — fetchBtcFeesLive / fetchBtcMempoolLive / fetchBtcStatsLive", () => {
  it("fetchBtcFeesLive parses fastestFee from mempool.space", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async () => ({ ok: true, json: async () => ({ fastestFee: 3, halfHourFee: 2, hourFee: 1 }) });
    expect(await dom.window.fetchBtcFeesLive()).toEqual({ satPerVb: 3, source: "mempool.space" });
  });

  it("fetchBtcFeesLive returns null if fastestFee is missing", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async () => ({ ok: true, json: async () => ({}) });
    expect(await dom.window.fetchBtcFeesLive()).toBeNull();
  });

  it("fetchBtcMempoolLive parses the pending tx count", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async () => ({ ok: true, json: async () => ({ count: 79513, vsize: 1 }) });
    expect(await dom.window.fetchBtcMempoolLive()).toEqual({ pendingCount: 79513, source: "mempool.space" });
  });

  it("fetchBtcStatsLive parses n_tx from blockchain.info", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async () => ({ ok: true, json: async () => ({ n_tx: 786009 }) });
    expect(await dom.window.fetchBtcStatsLive()).toEqual({ txPerDay: 786009, source: "Blockchain.com" });
  });
});

describe("onchain.js — fetchBtcOnchainLive (combines the 4 sources)", () => {
  it("keeps the sources that succeed and nulls only the one that fails", async () => {
    const dom = loadOnchainPage();
    dom.window.fetch = async (url) => {
      if (url.includes("llama.fi")) throw new Error("defillama down");
      if (url.includes("fees/recommended")) return { ok: true, json: async () => ({ fastestFee: 5 }) };
      if (url.includes("api/mempool")) return { ok: true, json: async () => ({ count: 100 }) };
      if (url.includes("blockchain.info")) return { ok: true, json: async () => ({ n_tx: 700000 }) };
      return { ok: false, status: 404 };
    };
    const r = await dom.window.fetchBtcOnchainLive();
    expect(r.tvl).toBeNull();
    expect(r.fees).toEqual({ satPerVb: 5, source: "mempool.space" });
    expect(r.mempool).toEqual({ pendingCount: 100, source: "mempool.space" });
    expect(r.stats).toEqual({ txPerDay: 700000, source: "Blockchain.com" });
  });
});

describe("onchain.js — renderOnchainLiveCards", () => {
  const dom = loadOnchainPage();
  const { renderOnchainLiveCards } = dom.window;

  it("shows an unavailable message when every source is null", () => {
    const html = renderOnchainLiveCards({ tvl: null, fees: null, mempool: null, stats: null });
    expect(html).toContain("indisponible");
  });

  it("shows an unavailable message for a null/undefined input", () => {
    expect(renderOnchainLiveCards(null)).toContain("indisponible");
  });

  it("renders only the metrics that are actually available", () => {
    const html = renderOnchainLiveCards({ tvl: { valueUsd: 4.18e9, source: "DefiLlama" }, fees: null, mempool: null, stats: null });
    expect(html).toContain("TVL du réseau");
    expect(html).toContain("DefiLlama");
    expect(html).not.toContain("Frais rapides");
  });
});

describe("onchain.js — renderMetricHistoryChart", () => {
  const dom = loadOnchainPage();
  const { renderMetricHistoryChart } = dom.window;
  const fmt = (v) => String(v);

  it("shows 'historique insuffisant' with 0 points", () => {
    const html = renderMetricHistoryChart("TVL", [], "tvl_usd", fmt, "1y");
    expect(html).toContain("Historique insuffisant");
    expect(html).toContain("0 point");
  });

  it("shows 'historique insuffisant' with exactly 1 point in the window", () => {
    const snapshots = [{ date: daysAgo(1), tvl_usd: 100 }];
    const html = renderMetricHistoryChart("TVL", snapshots, "tvl_usd", fmt, "1y");
    expect(html).toContain("Historique insuffisant");
  });

  it("renders a chart with 2+ real points in the window and computes the change", () => {
    const snapshots = [
      { date: daysAgo(10), tvl_usd: 100 },
      { date: daysAgo(1), tvl_usd: 110 },
    ];
    const html = renderMetricHistoryChart("TVL", snapshots, "tvl_usd", fmt, "1y");
    expect(html).not.toContain("Historique insuffisant");
    expect(html).toContain("110"); // dernier point, via fmt
    expect(html).toContain("+10.0 %");
    expect(html).toContain("class=\"hint positive\"");
  });

  it("excludes points outside the selected horizon window", () => {
    const snapshots = [
      { date: daysAgo(400), tvl_usd: 1 }, // hors 1 an (365j)
      { date: daysAgo(200), tvl_usd: 100 },
      { date: daysAgo(1), tvl_usd: 110 },
    ];
    const html1y = renderMetricHistoryChart("TVL", snapshots, "tvl_usd", fmt, "1y");
    expect(html1y).not.toContain("Historique insuffisant"); // 2 points dans la fenêtre 1 an

    const html1m = renderMetricHistoryChart("TVL", snapshots, "tvl_usd", fmt, "1m");
    expect(html1m).toContain("Historique insuffisant"); // 1 seul point dans la fenêtre 1 mois
  });

  it("skips snapshots missing the requested metric key instead of crashing", () => {
    const snapshots = [
      { date: daysAgo(5) }, // pas de tvl_usd ce jour-là
      { date: daysAgo(3), tvl_usd: 100 },
      { date: daysAgo(1), tvl_usd: 105 },
    ];
    expect(() => renderMetricHistoryChart("TVL", snapshots, "tvl_usd", fmt, "1y")).not.toThrow();
  });

  it("marks the active horizon tab and includes all 4 horizon options", () => {
    const html = renderMetricHistoryChart("TVL", [], "tvl_usd", fmt, "6m");
    expect(html).toContain('data-horizon="6m"');
    expect(html.match(/onchain-chart-tab active/g)).toHaveLength(1);
    ["1m", "3m", "6m", "1y"].forEach((k) => expect(html).toContain(`data-horizon="${k}"`));
  });

  it("defaults to the 3-month horizon when none is given", () => {
    const html = renderMetricHistoryChart("TVL", [], "tvl_usd", fmt);
    expect(html).toContain('<button type="button" class="onchain-chart-tab active" data-horizon="3m">');
  });
});

describe("onchain.js — renderOnchainSection", () => {
  const dom = loadOnchainPage();
  const { renderOnchainSection } = dom.window;

  it("returns an empty string for any asset other than bitcoin", () => {
    expect(renderOnchainSection("ethereum", null, null)).toBe("");
  });

  it("renders the section for bitcoin even with no history yet", () => {
    const html = renderOnchainSection("bitcoin", { tvl: null, fees: null, mempool: null, stats: null }, { assets: { bitcoin: { snapshots: [] } } });
    expect(html).toContain("Activité on-chain");
    expect(html).toContain("Historique insuffisant");
  });

  it("tolerates a missing/malformed onchainHistory argument", () => {
    expect(() => renderOnchainSection("bitcoin", null, null)).not.toThrow();
    expect(() => renderOnchainSection("bitcoin", null, {})).not.toThrow();
  });
});
