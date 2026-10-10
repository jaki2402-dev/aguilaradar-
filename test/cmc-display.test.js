import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

// data/cmc-favoris.json (scripts/cmc-snapshot.py) : valeurs réelles de CTSI au 10/10/2026.
const CMC = {
  as_of: "2026-10-10T22:55:00Z",
  assets: {
    CTSI: {
      cmc_id: 5444,
      price_usd: 0.0353061,
      rank: 519,
      change_pct: { "24h": 4.32, "7d": 17.49, "30d": 48.84, "90d": 52.3, "1y": -26.56, ytd: 6.16 },
      technical: { rsi14: 71.02, sma200: 0.027135, macd_histogram: 0.00030654 },
    },
    BTC: { cmc_id: 1, price_usd: 82990.22, rank: 1, change_pct: { "90d": 30.17, "1y": -27.3 }, technical: null },
  },
};

// Titre (avec sa bulle « ? » de glossaire) et valeur sont deux éléments distincts, espacés en CSS.
const rowText = (li) => [...li.children].map((c) => c.textContent.replace(/\?/g, "").trim()).join(" ");

describe("fiche détaillée : analyse technique CoinMarketCap", () => {
  function render(ticker, data) {
    const dom = loadPage(["config.js", "prices.js", "detail.js"], { html: "<!doctype html><html><body><div id='out'></div></body></html>" });
    dom.window.aguilaradarData = { cmcFavoris: data };
    const out = dom.window.document.getElementById("out");
    out.innerHTML = dom.window.renderCmcTechnicalSection(ticker);
    return out;
  }

  it("CTSI : RSI en surachat, cours 30 % au-dessus de la moyenne 200 j, élan MACD, évolutions longues", () => {
    const rows = [...render("CTSI", CMC).querySelectorAll(".cmc-rows li")].map(rowText);
    expect(rows).toEqual([
      "RSI 14 j 71 — zone de surachat",
      "Cours / moyenne 200 j +30 % (au-dessus)",
      "MACD élan haussier",
      "Évolution 90 j +52 % · 1 an −27 % · depuis janvier +6 %",
    ]);
  });

  it("sans analyse technique (BTC ce jour-là) : seulement les évolutions", () => {
    const rows = [...render("BTC", CMC).querySelectorAll(".cmc-rows li")].map(rowText);
    expect(rows).toEqual(["Évolution 90 j +30 % · 1 an −27 %"]);
  });

  it("rien si le fichier est absent ou si l'actif n'y est pas", () => {
    expect(render("CTSI", null).innerHTML).toBe("");
    expect(render("LINK", CMC).innerHTML).toBe("");
  });
});

describe("Assistant : analyse technique CoinMarketCap dans le contexte de l'IA", () => {
  async function context(cmcFavoris) {
    const dom = loadPage(["config.js", "assistant.js"]);
    dom.window.aguilaradarData = { verdicts: [], engineHistory: {}, marketContext: {}, cmcFavoris };
    await dom.window.ensureChatData();
    return dom.window.buildAiContext();
  }

  it("une ligne compacte par favori, surachat signalé", async () => {
    expect(await context(CMC)).toContain(
      "Analyse technique CoinMarketCap des favoris (relevé le 10/10) : CTSI : RSI14 71 (surachat), +30 % vs moyenne 200 j, MACD haussier, 90 j +52 %, 1 an -27 % ; BTC : 90 j +30 %, 1 an -27 %."
    );
  });

  it("rien quand le fichier est absent", async () => {
    expect(await context(null)).not.toContain("CoinMarketCap des favoris");
  });
});
