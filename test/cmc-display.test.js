import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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

// data/technical-favoris.json réel (robot technical-daily, 11/10/2026 02h UTC).
const ROBOT = JSON.parse(readFileSync(new URL("./fixtures/technical-favoris-20261011.json", import.meta.url), "utf-8"));

// Titre (avec sa bulle « ? » de glossaire) et valeur sont deux éléments distincts, espacés en CSS.
const rowText = (li) => [...li.children].map((c) => c.textContent.replace(/\?/g, "").trim()).join(" ");

describe("fiche détaillée : analyse technique du jour", () => {
  function render(ticker, data) {
    const dom = loadPage(["config.js", "prices.js", "detail.js"], { html: "<!doctype html><html><body><div id='out'></div></body></html>" });
    dom.window.aguilaradarData = data;
    const out = dom.window.document.getElementById("out");
    out.innerHTML = dom.window.renderDailyTechnicalSection(ticker);
    return out;
  }

  it("robot quotidien (prioritaire) : phrase de lecture, tendance + croisement, RSI, élan, volatilité, repli, évolutions", () => {
    const out = render("CTSI", { technicalFavoris: ROBOT, cmcFavoris: CMC });
    expect(out.querySelector(".text-resume").textContent).toBe("Tendance de fond haussière (+28 % vs moyenne 200 j), élan positif ; RSI 72 : surachat, mouvement étiré.");
    expect(out.textContent).toContain("calcul quotidien sur 1 an d'historique du 11/10");
    expect([...out.querySelectorAll(".cmc-rows li")].map(rowText)).toEqual([
      "Cours / moyenne 200 j +28 % (au-dessus) · MM50 au-dessus de la MM200",
      "RSI 14 j 72 — zone de surachat",
      "MACD élan haussier",
      "Volatilité 30 j 74 % par an",
      "Depuis le plus haut sur 1 an −44 %",
      "Évolution 30 j +46 % · 90 j +55 % · 1 an −33 %",
    ]);
  });

  it("sans fichier du robot : relevé CoinMarketCap (CTSI, RSI en surachat, cours 30 % au-dessus de la MM200)", () => {
    const rows = [...render("CTSI", { cmcFavoris: CMC }).querySelectorAll(".cmc-rows li")].map(rowText);
    expect(rows).toEqual([
      "Cours / moyenne 200 j +30 % (au-dessus)",
      "RSI 14 j 71 — zone de surachat",
      "MACD élan haussier",
      "Évolution 90 j +52 % · 1 an −27 % · depuis janvier +6 %",
    ]);
  });

  it("CoinMarketCap sans analyse technique (BTC ce jour-là) : seulement les évolutions", () => {
    const rows = [...render("BTC", { cmcFavoris: CMC }).querySelectorAll(".cmc-rows li")].map(rowText);
    expect(rows).toEqual(["Évolution 90 j +30 % · 1 an −27 %"]);
  });

  it("rien si aucune source n'a l'actif", () => {
    expect(render("CTSI", {}).innerHTML).toBe("");
    expect(render("LINK", { cmcFavoris: CMC }).innerHTML).toBe("");
  });
});

describe("Assistant : analyse technique et fiabilité mesurée dans le contexte de l'IA", () => {
  async function context(extra) {
    const dom = loadPage(["config.js", "assistant.js"]);
    dom.window.aguilaradarData = { verdicts: [], engineHistory: {}, marketContext: {}, ...extra };
    await dom.window.ensureChatData();
    return dom.window.buildAiContext();
  }

  it("robot : une ligne compacte par favori, dans l'ordre des favoris", async () => {
    const ctx = await context({ technicalFavoris: ROBOT, cmcFavoris: CMC });
    expect(ctx).toContain("Analyse technique des favoris (calcul quotidien du 11/10) : BTC : RSI14 43, +15 % vs moyenne 200 j, MACD baissier, volatilité 39 %/an, 30 j +8 %, 90 j +33 %, 1 an -25 % ; ETH : RSI14 29 (survente)");
    expect(ctx).toContain("CTSI : RSI14 72 (surachat), +28 % vs moyenne 200 j, MACD haussier");
    expect(ctx).not.toContain("CoinMarketCap des favoris");
  });

  it("robot : fiabilité mesurée du moteur, avec le cas du RSI en surachat", async () => {
    expect(await context({ technicalFavoris: ROBOT })).toContain(
      "Fiabilité mesurée du moteur sur 82 verdicts vérifiés : 25.6 % d'exacts. Il a dit ATTENTE 66 fois alors que le marché est resté stable dans 19 cas, monté nettement dans 44 et baissé dans 19. Verdicts émis avec un RSI ≥ 70 : 16, dont 4 suivis d'une hausse et 7 d'une baisse."
    );
  });

  it("sans robot : relevé CoinMarketCap, surachat signalé", async () => {
    expect(await context({ cmcFavoris: CMC })).toContain(
      "Analyse technique CoinMarketCap des favoris (relevé du 10/10) : BTC : 90 j +30 %, 1 an -27 % ; CTSI : RSI14 71 (surachat), +30 % vs moyenne 200 j, MACD haussier, 90 j +52 %, 1 an -27 %."
    );
  });

  it("rien quand aucun fichier n'existe", async () => {
    const ctx = await context({});
    expect(ctx).not.toContain("Analyse technique");
    expect(ctx).not.toContain("Fiabilité mesurée");
  });
});

describe("onglet Favoris : comparatif technique des 15", () => {
  function render(data) {
    const dom = loadPage(["config.js", "prices.js", "insights.js"], { html: "<!doctype html><html><body><div id='favoris-technical'></div><div id='engine-technical-backtest'></div></body></html>" });
    dom.window.renderFavorisTechnical(data);
    dom.window.renderTechnicalBacktest(data);
    return dom.window.document;
  }

  it("synthèse visible sans rien ouvrir, tableau trié par tendance de fond", () => {
    const doc = render(ROBOT);
    expect(doc.querySelector(".tech-compare summary .hint").textContent).toBe("15/15 au-dessus de leur moyenne 200 j · surachat : CTSI · survente : ETH, GRT, ONDO");
    const rows = [...doc.querySelectorAll("#favoris-technical tbody tr")];
    expect(rows).toHaveLength(15);
    expect(rows.map((r) => r.querySelector("th").textContent).slice(0, 3)).toEqual(["PEAQ", "AIOZ", "ARB"]);
    const ctsi = rows.find((r) => r.querySelector("th").textContent === "CTSI");
    expect([...ctsi.querySelectorAll("td")].map((c) => c.textContent)).toEqual(["+28\u00a0%", "72 surachat", "haussier", "+46\u00a0%", "74\u00a0%"]);
  });

  it("onglet Moteur : constats chiffrés et tableau des issues réelles", () => {
    const doc = render(ROBOT);
    const lead = [...doc.querySelectorAll("#engine-technical-backtest .text-resume")].map((p) => p.textContent);
    expect(lead[0]).toBe("Sur 82 verdicts vérifiés (depuis le 07/08), le moteur a vu juste dans 25,6 % des cas.");
    expect(lead[1]).toBe("Il a répondu ATTENTE 66 fois (80 %), alors que le cours est resté stable dans seulement 19 cas (23 %) : il a monté nettement dans 44 cas et baissé dans 19.");
    expect(lead[2]).toBe("Quand le RSI 14 j dépassait 70 le jour du verdict (16 cas), le cours a ensuite monté nettement dans 25 % des cas et baissé dans 44 %, contre 61 % et 18 % avec un RSI neutre.");
    const labels = [...doc.querySelectorAll("#engine-technical-backtest tbody th")].map((th) => th.textContent);
    expect(labels).toEqual(["RSI ≥ 70 (surachat)", "RSI neutre", "Cours au-dessus de la MM200", "Cours sous la MM200", "Tous les verdicts"]);
  });

  it("sans fichier : rien dans Favoris, message honnête dans Moteur", () => {
    const doc = render(null);
    expect(doc.getElementById("favoris-technical").innerHTML).toBe("");
    expect(doc.getElementById("engine-technical-backtest").textContent).toContain("pas encore disponible");
  });
});
