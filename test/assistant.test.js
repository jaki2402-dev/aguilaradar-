import { describe, it, expect, beforeEach } from "vitest";
import { loadPage, runScript } from "./helpers/loadPage.js";

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

describe("assistant.js — extractAssetQuery", () => {
  const dom = loadPage(["assistant.js"]);
  const { extractAssetQuery } = dom.window;

  it("isole un ticker en capitales, à n'importe quelle position", () => {
    expect(extractAssetQuery("c'est quoi XRPZZZ")).toBe("XRPZZZ");
  });

  it("isole un nom propre capitalisé au milieu de la phrase", () => {
    expect(extractAssetQuery("Tu connais Worldcoin ?")).toBe("Worldcoin");
  });

  it("ignore un mot capitalisé isolé en tête de phrase (majuscule de ponctuation française, pas un nom d'actif)", () => {
    expect(extractAssetQuery("Résume-moi la semaine")).toBeNull();
    expect(extractAssetQuery("Pourquoi le marché est-il neutre ?")).toBeNull();
    expect(extractAssetQuery("Quelles sont les meilleures opportunités ?")).toBeNull();
  });

  it("accepte un groupe de plusieurs mots capitalisés même en tête de phrase (signal trop fort pour être du bruit)", () => {
    expect(extractAssetQuery("The Sandbox va bien ?")).toBe("The Sandbox");
  });

  it("renvoie null sur une phrase sans ticker ni nom propre", () => {
    expect(extractAssetQuery("bonjour comment ça va")).toBeNull();
  });
});

describe("assistant.js — findAssetMention / answerQuestion (bout en bout)", () => {
  // FAVORIS (config.js), computeConfidence (cards.js, utilisé par answerOpportunities), les
  // fonctions d'indicateurs techniques (detail.js, utilisées par fetchLiveTechnicalSummary) et
  // searchCoinByName/fetchCoinDetail (search.js, utilisées par fetchLiveSearchAnswer) sont des
  // dépendances réelles de assistant.js — même ordre que index.html.
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "cards.js", "detail.js", "search.js", "assistant.js"]);
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

  it("recognizes a favori by its popular alias, not just its official name (régression réelle : 'fetch.ai' pour FET, dont le nom officiel a changé en 'Artificial Superintelligence Alliance')", async () => {
    const answer = await dom.window.answerQuestion("Est ce que fetch.ai va continuer de corriger ?");
    expect(answer).toContain("FET");
    expect(answer).not.toContain("Essaie par exemple"); // ne doit plus tomber sur le message générique
  });

  it("recognizes the FLUX alias 'zelcash' (piège de nommage documenté dans CLAUDE.md)", async () => {
    const answer = await dom.window.answerQuestion("Que penses-tu de zelcash ?");
    expect(answer).toContain("FLUX");
  });

  it("appends the correction_log status when the question asks about the engine's self-correction for a named tracked asset (même régression que 'fetch.ai' ci-dessus : la question portait aussi sur la correction)", async () => {
    const answer = await dom.window.answerQuestion("Est-ce que Chainlink va continuer d'être corrigé par le moteur ?");
    expect(answer).toContain("Aucune auto-correction tentée");
  });

  it("reports a real correction_log entry's fields (version/attempted_at/status/change_description/note) when present", async () => {
    dom.window.aguilaradarData.engineHistory.correction_log = [
      { version: "v1", attempted_at: "2026-08-10T00:00:00Z", status: "rejetée", change_description: "Test ancien", note: "" },
      { version: "v2", attempted_at: "2026-08-21T02:30:00Z", status: "appliquée", change_description: "Seuil de confiance relevé pour les verdicts ATTENTE", note: "Amélioration mesurée du F1 macro." },
    ];
    const answer = await dom.window.answerQuestion("Le moteur s'améliore-t-il tout seul ?");
    expect(answer).toContain("2 tentative(s)");
    expect(answer).toContain("appliquée");
    expect(answer).toContain("Seuil de confiance relevé pour les verdicts ATTENTE");
    expect(answer).not.toContain("Test ancien"); // seule la DERNIERE tentative est resumee
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

  it("searches CoinGecko live for a specific but untracked asset name, and returns real public data instead of a dead end", async () => {
    dom.window.fetch = async (url) => {
      if (url.includes("/search?")) {
        return { ok: true, json: async () => ({ coins: [{ id: "worldcoin-wld", name: "Worldcoin", symbol: "wld" }] }) };
      }
      return {
        ok: true,
        json: async () => [
          {
            name: "Worldcoin",
            symbol: "wld",
            current_price: 1.23,
            price_change_percentage_24h_in_currency: 5.5,
            price_change_percentage_7d_in_currency: -2.1,
            market_cap_rank: 45,
          },
        ],
      };
    };
    const answer = await dom.window.answerQuestion("Tu connais Worldcoin ?");
    expect(answer).toContain("Worldcoin");
    expect(answer).toContain("WLD");
    expect(answer).toContain("ne fait pas partie des 15 favoris");
    expect(answer).not.toContain("Je ne trouve pas cet actif");
  });

  it("falls back to the same 'not tracked' message when the live CoinGecko search itself finds nothing", async () => {
    dom.window.fetch = async () => ({ ok: true, json: async () => ({ coins: [] }) });
    const answer = await dom.window.answerQuestion("Tu connais Zorbaxqq ?");
    expect(answer).toContain("Je ne trouve pas cet actif");
  });

  it("answers a definition question from the glossary instead of misreading the term as a ticker to search (régression : 'c'est quoi le RSI' déclenchait une recherche CoinGecko sur 'RSI')", async () => {
    const answer = await dom.window.answerQuestion("c'est quoi le RSI ?");
    expect(answer).toContain("RSI :");
    expect(answer).toContain("suracheté");
    expect(answer).not.toContain("Je ne trouve pas cet actif");
  });

  it("recognizes another glossary-style phrasing ('explique-moi X')", async () => {
    const answer = await dom.window.answerQuestion("explique-moi l'ATH");
    expect(answer).toContain("ATH :");
    expect(answer).toContain("All-Time High");
  });

  it("gives priority to a tracked asset's real analysis over a glossary definition when both are named", async () => {
    const answer = await dom.window.answerQuestion("Chainlink, c'est quoi son horizon ?");
    expect(answer).toContain("ACHAT");
    expect(answer).not.toContain("Horizon :");
  });

  it("prioritizes a live search over the generic investing disclaimer when a specific untracked asset is named", async () => {
    // "que penses-tu" est aussi un mot-clé de answerGenericInvesting (CHAT_INTENTS) - un nom
    // d'actif explicite doit gagner sur ce disclaimer générique, pas l'inverse.
    dom.window.fetch = async (url) => {
      if (url.includes("/search?")) return { ok: true, json: async () => ({ coins: [{ id: "render-token", name: "Render", symbol: "rndr" }] }) };
      return { ok: true, json: async () => [{ name: "Render", symbol: "rndr", current_price: 5, market_cap_rank: 30 }] };
    };
    const answer = await dom.window.answerQuestion("Que penses-tu de Render ?");
    expect(answer).toContain("Render");
    expect(answer).not.toContain("Aguilaradar ne donne pas de conseil");
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

  it("recognizes 'bullrun' as a market-regime question instead of falling through to the generic message (régression réelle rapportée par l'utilisateur)", async () => {
    const answer = await dom.window.answerQuestion("Est ce qu'on est en bullrun ?");
    expect(answer).toContain("régime de marché actuel est classé");
    expect(answer).not.toContain("Essaie par exemple");
  });

  it("recognizes other bull/bear market phrasings ('bull market', 'haussier', 'baissier', 'bearish')", async () => {
    for (const q of ["On est en bull market ?", "Le marché est haussier ou baissier ?", "C'est bearish en ce moment ?"]) {
      const answer = await dom.window.answerQuestion(q);
      expect(answer).toContain("régime de marché actuel est classé");
    }
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

  it("never attempts the AI relay while AI_RELAY_URL is still an unconfigured placeholder — no fetch call at all", async () => {
    // AI_RELAY_URL vaut désormais la vraie URL déployée (config.js) - ce test vérifie
    // explicitement le comportement placeholder plutôt que de dépendre de la config de prod.
    runScript(dom, 'AI_RELAY_URL = "https://REMPLACE-MOI.workers.dev";', "reset AI_RELAY_URL to placeholder");
    let fetchCalled = false;
    dom.window.fetch = async () => {
      fetchCalled = true;
      throw new Error("ne devrait jamais être appelé");
    };
    const answer = await dom.window.answerQuestion("raconte-moi une blague de pêcheur");
    expect(fetchCalled).toBe(false);
    expect(answer).toContain("Essaie par exemple");
  });

  it("uses the AI relay as a genuine last resort once AI_RELAY_URL is configured, for a question nothing else could answer", async () => {
    runScript(dom, 'AI_RELAY_URL = "https://test-relay.workers.dev";', "set AI_RELAY_URL");
    dom.window.fetch = async (url, opts) => {
      expect(url).toBe("https://test-relay.workers.dev");
      const sent = JSON.parse(opts.body);
      expect(sent.question).toBe("raconte-moi une blague de pêcheur");
      expect(sent.context).toContain("neutre"); // vraies données du site incluses (macro_regime)
      return { ok: true, json: async () => ({ answer: "Pourquoi le bitcoin ne se fâche jamais ? Il reste toujours volatil, mais jamais énervé." }) };
    };
    const answer = await dom.window.answerQuestion("raconte-moi une blague de pêcheur");
    expect(answer).toContain("Pourquoi le bitcoin ne se fâche jamais");
    expect(answer).toContain("Réponse générée par IA");
  });

  it("still falls back to the generic message when the AI relay is configured but fails (network error, timeout, bad response)", async () => {
    runScript(dom, 'AI_RELAY_URL = "https://test-relay.workers.dev";', "set AI_RELAY_URL");
    dom.window.fetch = async () => {
      throw new Error("panne réseau simulée");
    };
    const answer = await dom.window.answerQuestion("raconte-moi une blague de pêcheur");
    expect(answer).toContain("Essaie par exemple");
  });

  it("NEVER lets the AI relay override an already-working answer, even when configured and reachable (zero-regression guarantee)", async () => {
    runScript(dom, 'AI_RELAY_URL = "https://test-relay.workers.dev";', "set AI_RELAY_URL");
    let fetchCalled = false;
    dom.window.fetch = async (url) => {
      // Le seul fetch legitime ici est fetchLiveTechnicalSummary (marche chart) pour Chainlink,
      // jamais un appel au relais IA - une question sur un actif suivi repond avant d'y arriver.
      fetchCalled = true;
      if (url.includes("test-relay.workers.dev")) throw new Error("le relais IA n'aurait jamais du etre appele ici");
      throw new Error("indisponible (comportement normal pour ce test)");
    };
    const answer = await dom.window.answerQuestion("Que penses-tu de Chainlink ?");
    expect(answer).toContain("ACHAT");
    expect(answer).not.toContain("Réponse générée par IA");
    expect(fetchCalled).toBe(true); // confirme que fetchLiveTechnicalSummary a bien tente son appel
  });

  // Bugs réels remontés par l'utilisateur : l'assistant "ne comprend pas le texte" et renvoie
  // une réponse automatique/générique — répétée même après un premier correctif ciblé sur les
  // phrases longues, l'utilisateur a explicitement demandé que TOUTE question passe par une
  // vraie lecture IA, pas seulement les longues ("je ne veux pas que tu mets juste des mots
  // clé... je veux que ça analyse"). Cause réelle des cas ci-dessous : un mot-clé isolé
  // ("monte") ou un nom propre cité en passant ("Twitter") interceptaient la question avant que
  // l'IA n'ait la moindre chance de la lire — voir tryKeywordFallback/answerQuestion.
  describe("priorité systématique à l'IA sur le mot-clé, courte ou longue phrase (comportement demandé par l'utilisateur)", () => {
    it("routes a long, nuanced question to the AI relay instead of the shallow 'monte' keyword match (régression réelle)", async () => {
      runScript(dom, 'AI_RELAY_URL = "https://test-relay.workers.dev";', "set AI_RELAY_URL");
      dom.window.fetch = async (url) => {
        expect(url).toBe("https://test-relay.workers.dev"); // jamais une recherche CoinGecko ici
        return { ok: true, json: async () => ({ answer: "La hausse reflète surtout un rebond technique après la panique de la semaine dernière, pas un vrai changement de fond." }) };
      };
      const answer = await dom.window.answerQuestion("Je ne comprends pas pourquoi ça monte alors que tout semble aller mal");
      expect(answer).toContain("rebond technique");
      expect(answer).not.toContain("régime de marché actuel est classé"); // pas le résumé générique answerMarketWhy
    });

    it("routes a long question mentioning an incidental capitalized word to the AI relay instead of dead-ending on a failed asset search (régression réelle : 'Twitter')", async () => {
      runScript(dom, 'AI_RELAY_URL = "https://test-relay.workers.dev";', "set AI_RELAY_URL");
      dom.window.fetch = async (url) => {
        if (url.includes("/search?")) return { ok: true, json: async () => ({ coins: [] }) }; // "Twitter" n'est pas un actif
        return { ok: true, json: async () => ({ answer: "Une rumeur sur un réseau social ne suffit pas à confirmer une vraie tendance de marché." }) };
      };
      const answer = await dom.window.answerQuestion("J'ai vu sur Twitter que le marché va chuter, tu en penses quoi ?");
      expect(answer).toContain("Une rumeur sur un réseau social");
      expect(answer).not.toContain("Je ne trouve pas cet actif");
    });

    it("still falls back to the shallow keyword-matched answer when the AI relay fails on a long question, rather than jumping straight to the fully generic message", async () => {
      runScript(dom, 'AI_RELAY_URL = "https://test-relay.workers.dev";', "set AI_RELAY_URL");
      dom.window.fetch = async () => { throw new Error("panne réseau simulée"); };
      const answer = await dom.window.answerQuestion("Je ne comprends pas pourquoi ça monte alors que tout semble aller mal");
      expect(answer).toContain("régime de marché actuel est classé"); // answerMarketWhy, meilleur que rien
      expect(answer).not.toContain("Essaie par exemple"); // pas le message totalement générique
    });

    it("calls the AI relay even for a short question — a short question deserves a real reading too, not just a keyword match (changement de comportement demandé explicitement par l'utilisateur)", async () => {
      runScript(dom, 'AI_RELAY_URL = "https://test-relay.workers.dev";', "set AI_RELAY_URL");
      let fetchCalled = false;
      dom.window.fetch = async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({ answer: "Le marché grimpe surtout porté par le rebond post-emploi US, pas un simple mot-clé." }) };
      };
      const answer = await dom.window.answerQuestion("Pourquoi ça monte ?"); // court : 3 mots
      expect(fetchCalled).toBe(true);
      expect(answer).toContain("Le marché grimpe surtout porté par le rebond post-emploi US");
      expect(answer).not.toContain("régime de marché actuel est classé"); // pas le résumé générique answerMarketWhy
    });

    it("still falls back to the keyword-matched answer for a short question when the AI relay itself is unreachable (filet de secours, pas le chemin par défaut)", async () => {
      runScript(dom, 'AI_RELAY_URL = "https://test-relay.workers.dev";', "set AI_RELAY_URL");
      dom.window.fetch = async () => { throw new Error("panne réseau simulée"); };
      const answer = await dom.window.answerQuestion("Pourquoi ça monte ?");
      expect(answer).toContain("régime de marché actuel est classé");
    });
  });
});
