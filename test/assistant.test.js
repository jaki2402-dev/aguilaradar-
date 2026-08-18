import { describe, it, expect, beforeEach } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

describe("assistant.js — wordBoundaryMatch", () => {
  const dom = loadPage(["assistant.js"]);
  const { wordBoundaryMatch } = dom.window;

  it("does not match a ticker as a substring inside an unrelated word (régression 2d4b186)", () => {
    // Bug reel constate : "Solana maintenant ?" repondait sur ENA, parce que "ena" est un
    // sous-texte de "maintenant" (verifie : "maintenant".includes("ena") === true).
    expect(wordBoundaryMatch("solana maintenant ?", "ena")).toBe(false);
  });

  it("matches the same needle as a real standalone word", () => {
    expect(wordBoundaryMatch("regarde ENA aujourd'hui", "ena")).toBe(true); // insensible a la casse
  });

  it("matches at the very start or end of the string", () => {
    expect(wordBoundaryMatch("BTC en hausse", "btc")).toBe(true);
    expect(wordBoundaryMatch("regarde le BTC.", "btc")).toBe(true);
  });

  it("treats French accented characters as word characters, not boundaries", () => {
    // "xéory" : "or" est encadre par é et y, tous deux dans la classe "caractere de mot"
    // de la regex -> aucune frontiere reelle -> pas de match.
    expect(wordBoundaryMatch("xéory", "or")).toBe(false);
    expect(wordBoundaryMatch("xé or y", "or")).toBe(true); // avec de vraies frontieres (espaces)
  });

  it("is false for an empty/falsy needle, and never throws on regex special characters", () => {
    expect(wordBoundaryMatch("bonjour", "")).toBe(false);
    expect(() => wordBoundaryMatch("prix (BTC) en hausse", "(BTC)")).not.toThrow();
  });
});

describe("assistant.js — looksLikeUnknownAssetMention", () => {
  const dom = loadPage(["assistant.js"]);
  const { looksLikeUnknownAssetMention } = dom.window;

  it("matches a ticker-shaped all-caps token", () => {
    expect(looksLikeUnknownAssetMention("WXYZ va bien ?")).toBe(true);
  });

  it("matches asset-related keywords", () => {
    expect(looksLikeUnknownAssetMention("des news sur ce token")).toBe(true);
  });

  it("does not match plain prose with neither signal", () => {
    expect(looksLikeUnknownAssetMention("comment tu vas aujourdhui")).toBe(false);
  });
});

describe("assistant.js — findAssetMention / answerQuestion (bout en bout)", () => {
  // FAVORIS (config.js), computeConfidence (cards.js, utilisé par answerOpportunities) et les
  // fonctions d'indicateurs techniques (detail.js, utilisées par fetchLiveTechnicalSummary)
  // sont des dépendances réelles de assistant.js — même ordre que index.html.
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "cards.js", "detail.js", "assistant.js"]);
    dom.window.aguilaradarData = {
      verdicts: [
        {
          asset: "chainlink",
          ticker: "LINK",
          verdict: "ACHAT",
          confidence_pct: 70,
          horizon_days: 14,
          issued_at: "2026-08-10T00:00:00Z",
          reasoning: "Cassure haussière confirmée.",
        },
      ],
      opportunities: {
        opportunities: [
          { cgId: "cardano", ticker: "ADA", name: "Cardano", reason: "Momentum fort", price_eur: 0.5, change_7d_pct: 12, market_cap_rank: 20, recognized: true },
        ],
      },
      alerts: [{ triggered_at: "2026-08-15T00:00:00Z", ticker_ou_theme: "BTC", message: "Seuil RSI franchi", type: "seuil_technique" }],
      news: [],
      engineHistory: {
        global_stats: { total_verdicts_issued: 16, total_verdicts_resolved: 1, accuracy_strict_pct: null },
        macro_regime: { regime: "neutre", fear_greed_value: 49, btc_dominance_pct: 56.3, note: "Stable." },
      },
      marketContext: {},
      digest: { generated_at: "2026-08-17T06:00:00Z", headline: "Marché stable", summary: "Résumé de la semaine.", tips: ["Prudence"], market_tone: "neutre" },
    };
  });

  it("answers with the real verdict for a tracked favori mentioned by name", async () => {
    const answer = await dom.window.answerQuestion("Que penses-tu de Chainlink ?");
    expect(answer).toContain("ACHAT");
    expect(answer).toContain("Cassure haussière confirmée.");
  });

  it("falls back silently to the routine verdict alone when the live price-history fetch is unavailable (no network fetch defined in this test environment, by design)", async () => {
    // Aucun dom.window.fetch defini ici : fetchMarketChartData leve, fetchLiveTechnicalSummary
    // rattrape et renvoie null - la reponse existante ne doit ni planter ni changer de forme.
    expect(dom.window.fetch).toBeUndefined();
    const answer = await dom.window.answerQuestion("Que penses-tu de Chainlink ?");
    expect(answer).toContain("ACHAT");
    expect(answer).not.toContain("Indicateurs techniques en direct");
  });

  it("adds a live technical-indicators block (RSI/tendance/volume) for a tracked asset when the price-history fetch succeeds", async () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5); // hausse reguliere -> tendance haussiere et RSI eleve sans ambiguite
    const volumes = Array.from({ length: 60 }, () => 1000);
    dom.window.fetch = async () => ({
      ok: true,
      json: async () => ({
        prices: closes.map((c, i) => [i, c]),
        total_volumes: volumes.map((v, i) => [i, v]),
      }),
    });
    const answer = await dom.window.answerQuestion("Que penses-tu de Chainlink ?");
    expect(answer).toContain("Indicateurs techniques en direct");
    expect(answer).toContain("RSI");
    expect(answer).toContain("Alignement haussier des moyennes");
  });

  it("answers with the tracked opportunity when the asset is only in the screening list, not the favoris", async () => {
    const answer = await dom.window.answerQuestion("Parle-moi de Cardano");
    expect(answer).toContain("Momentum fort");
  });

  it("routes a digest-shaped question to the periodic summary", async () => {
    const answer = await dom.window.answerQuestion("Résume-moi la semaine");
    expect(answer).toContain("Marché stable");
  });

  it("routes an opportunities-shaped question to the ranked opportunities list", async () => {
    const answer = await dom.window.answerQuestion("Quelles sont les meilleures opportunités ?");
    expect(answer).toContain("ADA");
  });

  it("routes a market-regime question using the macro_regime data", async () => {
    const answer = await dom.window.answerQuestion("Pourquoi le marché est-il neutre ?");
    expect(answer).toContain("neutre");
    expect(answer).toContain("56.3");
  });

  it("routes an alerts-shaped question to the recent alerts list", async () => {
    const answer = await dom.window.answerQuestion("Quelles sont les dernières alertes ?");
    expect(answer).toContain("Seuil RSI franchi");
  });

  it("routes an engine-performance question, correctly withholding an accuracy rate that isn't measurable yet", async () => {
    const answer = await dom.window.answerQuestion("Le moteur est-il fiable ?");
    expect(answer).toContain("16");
    expect(answer).not.toMatch(/exactitude de [\d.]+ ?%/);
  });

  it("falls back to the 'not tracked' answer for an untracked asset-shaped question that doesn't collide with another intent's keywords", async () => {
    const answer = await dom.window.answerQuestion("c'est quoi XRPZZZ");
    expect(answer).toContain("Je ne trouve pas cet actif");
  });

  it("falls back to the generic help message for unrelated prose", async () => {
    const answer = await dom.window.answerQuestion("bonjour comment ça va");
    expect(answer).toContain("Essaie par exemple");
  });
});
