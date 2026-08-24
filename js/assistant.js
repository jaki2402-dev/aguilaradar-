// Assistant : répond aux questions à partir des données déjà calculées par les routines
// (résumé, verdicts, opportunités, alertes, contexte marché).
//
// Deux familles de réponses, dans cet ordre de priorité :
//
// 1. Données FACTUELLES SOURCÉES — toujours vérifiées avant tout le reste, jamais remplacées
//    par une reformulation IA qui pourrait déformer un chiffre : un actif suivi nommément
//    (favori ou opportunité, verdict + raisonnement du cycle profond), une définition de
//    glossaire, ou une recherche CoinGecko EN DIRECT pour un actif nommé mais non suivi (voir
//    extractAssetQuery/fetchLiveSearchAnswer — mêmes fonctions que search.js). Pour un actif
//    suivi, la réponse ajoute aussi un bloc d'indicateurs techniques calculés EN DIRECT (RSI,
//    tendance, volume — mêmes fonctions pures que detail.js) ; best-effort, un échec réseau
//    fait juste disparaître ce bloc plutôt que toute la réponse (fetchLiveTechnicalSummary).
//
// 2. Tout le reste (question générale, analytique, conversationnelle) — passe par le relais IA
//    (fetchLiveAiFallback, cloudflare-worker/) EN PREMIER, quelle que soit la longueur de la
//    question. Bug réel corrigé ici : un mot-clé isolé (CHAT_INTENTS) répondait "automatiquement"
//    à la place d'une vraie lecture de la question — ex. "bullrun" ne matchait aucun mot-clé et
//    tombait sur le message générique, ou pire, un mot-clé approximatif matchait AVANT que l'IA
//    ait la moindre chance de vraiment lire une phrase nuancée. Le mot-clé (CHAT_INTENTS) ne
//    sert plus que de filet de secours si l'IA est indisponible (AI_RELAY_URL non configuré,
//    placeholder par défaut — voir fetchLiveAiFallback) ou échoue (réseau, timeout) : dans ce
//    cas seulement, le site retombe sur une réponse plus fruste plutôt que rien.

let chatData = null;
let chatDataLoading = null;

async function ensureChatData() {
  if (window.aguilaradarData && window.aguilaradarData.verdicts !== undefined) {
    chatData = window.aguilaradarData;
    return chatData;
  }
  if (chatDataLoading) return chatDataLoading;
  chatDataLoading = Promise.all([
    loadJson(DATA_URLS.verdicts),
    loadJson(DATA_URLS.opportunities),
    loadJson(DATA_URLS.alerts),
    loadJson(DATA_URLS.news),
    loadJson(DATA_URLS.engineHistory),
    loadJson(DATA_URLS.marketContext),
    loadJson(DATA_URLS.digest),
  ]).then(([verdicts, opportunities, alerts, news, engineHistory, marketContext, digest]) => {
    chatData = { verdicts, opportunities, alerts, news, engineHistory, marketContext, digest };
    return chatData;
  });
  return chatDataLoading;
}

// Correspondance sur un mot ENTIER, jamais un simple sous-texte — sans ça, un ticker court
// comme "ENA" matche à l'intérieur de "maintenant", ce qui donnait des réponses sur le
// mauvais actif (bug réel constaté : "Solana maintenant ?" répondait sur Ethena).
function wordBoundaryMatch(haystack, needle) {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9àâäéèêëïîôöùûüç])${escaped}($|[^a-z0-9àâäéèêëïîôöùûüç])`, "i").test(haystack);
}

function findAssetMention(text) {
  const norm = text.toLowerCase();
  // aliases (config.js) : couvre un nom populaire/historique différent du nom officiel actuel
  // (ex. FET toujours largement appelé "Fetch.ai" alors que le nom officiel a changé pour
  // "Artificial Superintelligence Alliance" ; FLUX/zelcash, piège déjà documenté dans CLAUDE.md).
  const fav = FAVORIS.find(
    (f) =>
      wordBoundaryMatch(norm, f.ticker.toLowerCase()) ||
      wordBoundaryMatch(norm, f.name.toLowerCase()) ||
      (f.aliases || []).some((a) => wordBoundaryMatch(norm, a.toLowerCase()))
  );
  if (fav) return { cgId: fav.cgId, ticker: fav.ticker, name: fav.name, tracked: "favori" };
  const opp = ((chatData.opportunities && chatData.opportunities.opportunities) || []).find(
    (o) => wordBoundaryMatch(norm, o.ticker.toLowerCase()) || wordBoundaryMatch(norm, o.name.toLowerCase())
  );
  if (opp) return { cgId: opp.cgId, ticker: opp.ticker, name: opp.name, tracked: "opportunite" };
  return null;
}

// Repère un mot qui ressemble à un nom de projet/ticker que la question mentionne mais que
// ni les favoris ni les opportunités ne couvrent — pour répondre "pas suivi" au lieu de
// tomber sur le message générique quand la question visait clairement un actif précis.
function looksLikeUnknownAssetMention(text) {
  return /\b[A-Z]{2,6}\b/.test(text) || /\b(bitcoin|coin|token|crypto|monnaie|actif|projet)\b/i.test(text);
}

// Mots qui ressemblent à un ticker/nom propre mais n'en sont jamais un dans une question en
// français — sans cette liste, un ticker tapé en capitales (ex. "QUE") ou un nom propre isolé
// resterait un faux positif malgré le filtre de position ci-dessous. rsi/ath/atl : sigles
// techniques en capitales (matchent la regex de ticker) mais jamais des actifs à chercher —
// bug réel constaté avant ce correctif : "c'est quoi le RSI" déclenchait une recherche
// CoinGecko sur "RSI" au lieu de répondre depuis le glossaire (voir findGlossaryTerm).
// ia/ok/nft/dex/... : mêmes piège que rsi/ath/atl mais pour des sigles crypto/macro/tech
// courants dans une phrase française normale — bug réel confirmé (recherche CoinGecko réelle) :
// "IA" renvoie "World Liberty Financial" en tête de liste, "OK" renvoie "LEO Token", "NFT"
// renvoie "AINFT" — donc "L'IA peut-elle analyser le marché ?", "OK, et les perspectives
// macro ?" ou "c'est quoi un NFT ?" partaient sur une recherche CoinGecko live sans rapport
// AVANT même que le relais IA ait la moindre chance de lire la question.
const ASSET_QUERY_STOPWORDS = new Set([
  "que", "qui", "quoi", "comment", "pourquoi", "quel", "quelle", "quels", "quelles", "résume", "resume",
  "rsi", "ath", "atl",
  "ia", "ok", "nft", "dex", "dao", "roi", "apy", "apr", "tvl", "ico", "ido", "etf", "usd", "eur",
  "fed", "bce", "pib", "ue", "usa", "api", "faq", "url", "pdf", "sms", "ceo", "cto", "gpu", "cpu",
]);

// Sous-ensemble du glossaire (GLOSSARY, config.js) utile en question directe dans le chat —
// "Backtest" et "Régime de marché" sont volontairement exclus : le moteur a déjà une réponse
// dynamique bien plus riche pour ces deux-là (answerEngine/answerMarketWhy dans CHAT_INTENTS),
// la définition statique du glossaire serait un appauvrissement, pas une aide.
const GLOSSARY_CHAT_KEYS = [
  ["rsi", "RSI"],
  ["mm20", "MM20 / MM50"],
  ["mm50", "MM20 / MM50"],
  ["moyenne mobile", "MM20 / MM50"],
  ["ath", "ATH"],
  ["all-time high", "ATH"],
  ["confiance", "Confiance"],
  ["horizon", "Horizon"],
  ["seuil directionnel", "Seuil directionnel"],
  ["dominance", "Dominance BTC"],
  ["peur et de cupidité", "Indice de peur et de cupidité"],
  ["peur et cupidité", "Indice de peur et de cupidité"],
  ["signal précoce", "Signal précoce"],
  ["verdict", "Verdict (ACHAT / ATTENTE / VENTE)"],
];

const GLOSSARY_DEFINITION_PATTERNS = [/c'est quoi/i, /qu'est-ce que/i, /que veut dire/i, /\bexplique/i, /à quoi sert/i, /ça veut dire/i, /\bdéfini/i];

// Répond aux questions de définition ("c'est quoi le RSI ?", "explique-moi l'ATH") avec le
// même texte que le glossaire débutant de l'accueil — seulement si la question a la forme
// d'une définition ET matche un terme connu, jamais un faux positif sur une mention normale
// du mot (ex. "le RSI de Bitcoin est haut" ne doit pas partir sur cette branche).
function findGlossaryTerm(text) {
  if (!GLOSSARY_DEFINITION_PATTERNS.some((re) => re.test(text))) return null;
  const norm = text.toLowerCase();
  const hit = GLOSSARY_CHAT_KEYS.find(([key]) => wordBoundaryMatch(norm, key) || norm.includes(key));
  if (!hit) return null;
  return GLOSSARY.find((g) => g.term === hit[1]) || null;
}

// Best-effort pour isoler QUOI chercher en direct sur CoinGecko dans une question libre — pas
// une vraie compréhension du langage. Deux signaux, par ordre de fiabilité :
//  1. un ticker en capitales (ex. "XRPZZZ") — fiable à n'importe quelle position ;
//  2. un Nom Propre capitalisé (1 à 3 mots), à condition de ne PAS être le premier mot isolé de
//     la phrase — en français une phrase commence presque toujours par une majuscule
//     ("Résume-moi...", "Pourquoi...", "Quelles..."), donc un seul mot capitalisé en tête de
//     phrase est du bruit grammatical, pas un nom d'actif. Un groupe de plusieurs mots
//     capitalisés reste accepté même en tête ("The Sandbox va bien ?").
function extractAssetQuery(text) {
  const trimmed = text.trim();
  const ticker = trimmed.match(/\b[A-Z]{2,6}\b/);
  if (ticker && !ASSET_QUERY_STOPWORDS.has(ticker[0].toLowerCase())) return ticker[0];

  const properNouns = trimmed.match(/\b[A-ZÀ-Ý][a-zà-ÿ']{2,}(?:\s+[A-ZÀ-Ý][a-zà-ÿ']{2,}){0,2}\b/g) || [];
  for (const candidate of properNouns) {
    if (ASSET_QUERY_STOPWORDS.has(candidate.toLowerCase())) continue;
    const isMultiWord = candidate.includes(" ");
    if (!isMultiWord && trimmed.startsWith(candidate)) continue;
    return candidate;
  }
  return null;
}

// Isolée de answerQuestion pour la même raison que fetchLiveTechnicalSummary : un échec réseau
// (limite CoinGecko, hors-ligne) doit juste faire retomber sur le message "pas suivi" existant,
// jamais planter toute la réponse. Réutilise les fonctions réseau de search.js telles quelles —
// aucune requête CoinGecko divergente propre à l'assistant.
async function fetchLiveSearchAnswer(query) {
  try {
    const matches = await searchCoinByName(query);
    if (!matches || matches.length === 0) return null;
    // La recherche CoinGecko est floue : pour une requête courte (<=3 caractères, donc pas déjà
    // écartée par ASSET_QUERY_STOPWORDS), le premier résultat peut n'avoir aucun rapport avec le
    // texte tapé (constaté : "OK" renvoie "LEO Token" en tête, dont le ticker n'est même pas
    // "OK"). N'accepte un match aussi court que s'il correspond EXACTEMENT au ticker cherché.
    if (query.length <= 3 && (matches[0].symbol || "").toLowerCase() !== query.toLowerCase()) return null;
    const coin = await fetchCoinDetail(matches[0].id);
    if (!coin) return null;
    const name = coin.name || matches[0].name;
    const ticker = (coin.symbol || matches[0].symbol || "").toUpperCase();
    return (
      `${name} (${ticker}) ne fait pas partie des 15 favoris ni des opportunités suivies par le moteur — pas de verdict ni de raisonnement dessus, mais voici ses données publiques en direct (CoinGecko) :\n\n` +
      `Prix ${formatPrice(coin.current_price, "EUR")}, ${formatChangePct(coin.price_change_percentage_24h_in_currency)} sur 24h, ${formatChangePct(coin.price_change_percentage_7d_in_currency)} sur 7 jours. Rang capitalisation #${coin.market_cap_rank ?? "—"}.\n\n` +
      `Fiche complète et graphique dans l'onglet Recherche.`
    );
  } catch (e) {
    return null;
  }
}

// Isolée de answerAboutAsset comme detail.js isole renderTechnicalSection de renderDetailPanel,
// et pour la même raison : un échec réseau ici ne doit jamais faire échouer toute la réponse.
async function fetchLiveTechnicalSummary(cgId) {
  try {
    const { closes, volumes } = await fetchMarketChartData(cgId, VOLUME_PROFILE_DAYS);
    if (!closes || closes.length < 15) return null;
    const price = closes[closes.length - 1];
    const rsi = computeRSI(closes, 14);
    const sma20 = computeSMA(closes, 20);
    const sma50 = computeSMA(closes, Math.min(50, closes.length));
    const signals = technicalSignalSentences(price, sma20, sma50, rsi, null);

    const volumeProfile = computeVolumeProfile(closes, volumes, 24);
    const vpSignal = volumeProfileSignal(price, volumeProfile);
    if (vpSignal) signals.push(vpSignal);

    const divergence = detectDivergence(closes);
    if (divergence) {
      signals.push({
        label: "Divergence baissière prix/RSI",
        text: `RSI en baisse (${divergence.rsiNow.toFixed(0)} contre ${divergence.rsiPast.toFixed(0)} il y a ~3 semaines) alors que le prix reste proche de son plus haut récent — signal classique d'essoufflement, pas une certitude.`,
      });
    }

    if (signals.length === 0) return null;
    return (
      "Indicateurs techniques en direct (calculés à l'instant, indépendamment du dernier verdict) :\n" +
      signals.map((s) => `• ${s.label} : ${s.text}`).join("\n")
    );
  } catch (e) {
    return null;
  }
}

// Reconnaît une question sur l'auto-correction du moteur lui-même (mécanisme, pas juste
// "est-ce fiable") — distinct des mots-clés "performance/moteur" existants qui pointent déjà
// vers answerEngine, pour rester utilisable aussi bien seul ("le moteur se corrige-t-il ?")
// qu'à côté d'un actif nommé ("est-ce que fetch.ai va continuer de corriger ?").
// Racines, pas des formes conjuguées exactes : "corrig" seul couvre corrige/corrigé/corriger/
// corrigera (bug réel constaté en écrivant les tests ci-dessous : lister "corrige"/"corriger"
// sans le tronc commun ratait "corrigé", l'accent aigu n'étant pas la même lettre que "e" nu).
const CORRECTION_KEYWORDS = /\b(corrig|amélior|amelior|apprend|apprentissage|ajuste|auto-correct)/i;

// Résumé du journal des auto-corrections (correction_log, engine-history.json) — même schéma
// réel que celui rendu dans l'onglet Moteur (engine.js) depuis son correctif : id/logged_at/
// trigger/what/why/action/status ("accepted"/"rejected")/validation_score_before_pct/
// validation_score_after_pct (voir CLAUDE.md). Volontairement séparé de answerEngine pour être
// réutilisable aussi depuis answerAboutAsset (question sur un actif nommé ET sur la correction
// en même temps).
function correctionLogSummary() {
  const log = (chatData.engineHistory && chatData.engineHistory.correction_log) || [];
  if (log.length === 0) {
    return "Aucune auto-correction tentée pour l'instant — le moteur a besoin de plusieurs verdicts vérifiés avant de juger si un ajustement est justifié (rythme volontairement mesuré, pas un réglage permanent toutes les quelques minutes).";
  }
  const last = log[log.length - 1];
  const statusLabel = last.status === "accepted" ? "appliquée" : "rejetée";
  const dateLabel = last.logged_at ? new Date(last.logged_at).toLocaleDateString("fr-FR") : "date inconnue";
  return `${log.length} tentative(s) d'auto-correction enregistrée(s) à ce jour. La dernière (${dateLabel}, ${statusLabel}) : ${last.what || ""} ${last.action || ""}`.trim();
}

async function answerAboutAsset(mention, question) {
  const technical = await fetchLiveTechnicalSummary(mention.cgId);
  const askedAboutCorrection = CORRECTION_KEYWORDS.test(question || "");
  const withExtras = (text) => {
    let out = text;
    if (technical) out += `\n\n${technical}`;
    // La correction (correction_log) est une propriété du MOTEUR dans son ensemble, jamais
    // par actif individuel — même mention quel que soit l'actif demandé, pas une donnée
    // spécifique à mention.cgId qui n'existe pas.
    if (askedAboutCorrection) out += `\n\n${correctionLogSummary()}`;
    return out;
  };

  if (mention.tracked === "favori") {
    const verdict = (chatData.verdicts || [])
      .filter((v) => v.asset === mention.cgId)
      .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))[0];
    if (!verdict) {
      return withExtras(`${mention.name} (${mention.ticker}) fait partie des 15 favoris suivis, mais aucun verdict n'a encore été émis.`);
    }
    return withExtras(
      `Sur ${mention.name} (${mention.ticker}), le dernier verdict est ${verdict.verdict} (confiance ${verdict.confidence_pct ?? "—"} %, horizon ${verdict.horizon_days} j, émis le ${new Date(verdict.issued_at).toLocaleDateString("fr-FR")}).\n\n${verdict.reasoning || ""}\n\nDétail complet dans l'onglet Favoris.`
    );
  }
  const opp = ((chatData.opportunities && chatData.opportunities.opportunities) || []).find((o) => o.cgId === mention.cgId);
  if (!opp) return `${mention.name} (${mention.ticker}) n'est pas suivi par le moteur pour l'instant — utilise la recherche de l'onglet Favoris pour un prix et une fiche d'identité en direct.`;
  return withExtras(
    `${mention.name} (${mention.ticker}) fait partie des opportunités suivies (criblage Top 300) : ${opp.reason || "pas de détail disponible"}\n\nPrix actuel ${formatPrice(opp.price_eur, "EUR")}, ${formatChangePct(opp.change_7d_pct)} sur 7 jours. Détail complet dans l'onglet Opportunités.`
  );
}

function answerDigest() {
  const d = chatData.digest;
  if (!d || !d.generated_at) return "Le résumé périodique n'a pas encore été généré — reviens un peu plus tard.";
  const tips = (d.tips || []).map((t) => "• " + t).join("\n");
  return `${d.headline}\n\n${d.summary}${tips ? "\n\n" + tips : ""}\n\n(Résumé généré le ${new Date(d.generated_at).toLocaleString("fr-FR")}, ton du marché : ${d.market_tone}.)`;
}

function answerMarketWhy() {
  const regime = chatData.engineHistory && chatData.engineHistory.macro_regime;
  if (!regime || !regime.regime) return "Le régime de marché n'a pas encore été calculé — ça se fait au premier cycle profond.";
  const label = (typeof REGIME_LABELS !== "undefined" && REGIME_LABELS[regime.regime]) || regime.regime;
  const dominance = regime.btc_dominance_pct !== null && regime.btc_dominance_pct !== undefined ? regime.btc_dominance_pct.toFixed(1) + " %" : "—";
  let text = `Le régime de marché actuel est classé "${label}" (indice de peur et de cupidité ${regime.fear_greed_value ?? "—"}, dominance BTC ${dominance}).\n\n${regime.note || ""}`;
  const ctx = chatData.marketContext;
  if (ctx && ctx.employment_us && ctx.employment_us.market_reaction_note) {
    text += `\n\nContexte macro complémentaire : ${ctx.employment_us.market_reaction_note}`;
  }
  return text;
}

function answerOpportunities() {
  const items = ((chatData.opportunities && chatData.opportunities.opportunities) || [])
    .slice()
    .sort((a, b) => computeConfidence(b) - computeConfidence(a))
    .slice(0, 3);
  if (items.length === 0) return "Aucune opportunité détectée pour l'instant — le criblage Top 300 se fait à chaque cycle profond.";
  const lines = items.map((o) => `• ${o.ticker} (${o.name}) — confiance ${computeConfidence(o)} % : ${o.reason}`);
  return `Les opportunités les plus solides en ce moment :\n\n${lines.join("\n")}\n\nListe complète dans l'onglet Opportunités.`;
}

function answerAlerts() {
  const recent = (chatData.alerts || []).slice(-5).reverse();
  if (recent.length === 0) return "Aucune alerte enregistrée pour l'instant.";
  const lines = recent.map((a) => `• [${new Date(a.triggered_at).toLocaleDateString("fr-FR")}] ${a.ticker_ou_theme || ""} — ${a.message}`);
  return `Dernières alertes :\n\n${lines.join("\n\n")}\n\nHistorique complet dans l'onglet Alertes.`;
}

function answerEngine() {
  const stats = chatData.engineHistory && chatData.engineHistory.global_stats;
  if (!stats) return `Pas encore de statistiques du moteur disponibles.\n\n${correctionLogSummary()}`;
  if (stats.accuracy_strict_pct === null || stats.accuracy_strict_pct === undefined) {
    return `Le moteur a émis ${stats.total_verdicts_issued} verdict(s) au total, mais aucun n'a encore atteint son échéance — impossible de mesurer un vrai taux de réussite avant ça (rien n'est inventé entre-temps).\n\n${correctionLogSummary()}\n\nDétail dans l'onglet Moteur.`;
  }
  return `Le moteur a émis ${stats.total_verdicts_issued} verdicts, dont ${stats.total_verdicts_resolved} vérifiés, avec une exactitude de ${stats.accuracy_strict_pct.toFixed(1)} %.\n\n${correctionLogSummary()}\n\nDétail complet dans l'onglet Moteur.`;
}

function answerGenericInvesting() {
  return `Aguilaradar ne donne pas de conseil en investissement réglementé — seulement de l'analyse informative. Pour un actif précis, demande-moi directement par son nom ou son ticker (ex. "que penses-tu de Chainlink ?") : s'il fait partie des 15 favoris ou des opportunités suivies, je te donne le vrai verdict du moteur avec son raisonnement. Sinon, utilise la recherche de l'onglet Favoris pour un prix et une fiche d'identité en direct.`;
}

const CHAT_INTENTS = [
  { keywords: ["résume", "resume", "résumé", "briefing", "synthèse", "synthese", "récap", "recap"], handler: answerDigest },
  { keywords: ["opportunité", "opportunites", "opportunités", "pépite", "pepite", "meilleur", "prometteur", "bon plan", "bons plans"], handler: answerOpportunities },
  { keywords: ["alerte", "actualité", "actualites", "actualités", "news", "quoi de neuf", "du nouveau", "s'est-il passé", "sest il passe"], handler: answerAlerts },
  { keywords: ["performance", "taux de réussite", "taux de reussite", "précision", "precision", "moteur", "backtest", "rétrotest", "retrotest", "fiable", "se trompe", "corrig", "amélior", "amelior", "apprend", "apprentissage"], handler: answerEngine },
  { keywords: ["pourquoi", "hausse", "baisse", "monte", "descend", "chute", "analyse du marché", "analyse le marché", "analyse-moi le marché", "état du marché", "etat du marche", "comment va le marché", "comment va le marche", "où va le marché", "ou va le marche", "régime", "regime", "tendance", "sentiment", "bullrun", "bull run", "bull market", "bear market", "haussier", "baissier", "bullish", "bearish"], handler: answerMarketWhy },
  { keywords: ["investir", "acheter", "vendre", "placer", "position", "que penses-tu", "quel est ton avis", "ton avis", "conseil", "conseilles"], handler: answerGenericInvesting },
];

// Contexte compact envoyé au relais IA (cloudflare-worker/, dernier recours seulement, voir
// fetchLiveAiFallback) — jamais le JSON brut complet (trop gros, ralentirait chaque appel).
// chatData est déjà chargé par ensureChatData au moment où ceci est appelé, aucun fetch de plus.
function buildAiContext() {
  const parts = [];
  const regime = chatData.engineHistory && chatData.engineHistory.macro_regime;
  if (regime && regime.regime) {
    parts.push(`Régime de marché : ${regime.regime} (peur/cupidité ${regime.fear_greed_value ?? "—"}, dominance BTC ${regime.btc_dominance_pct ?? "—"} %). ${regime.note || ""}`);
  }
  const d = chatData.digest;
  if (d && d.generated_at) parts.push(`Résumé du moment : ${d.headline} — ${d.summary}`);

  // Contexte macro élargi (data/market-context.json) — champs numériques compacts seulement,
  // jamais les champs "note" (paragraphes entiers) pour ne pas saturer les 6000 caractères de
  // contexte acceptés par le relais IA (voir worker.js) au détriment du reste (opportunités,
  // alertes). Sans ça, une question macro ("la Fed a annoncé quoi ?", "les ETF sont haussiers ?")
  // n'avait aucune vraie donnée à citer alors que le site les calcule déjà.
  const ctx = chatData.marketContext;
  if (ctx && ctx.stablecoins && ctx.stablecoins.dominance_pct != null) {
    parts.push(`Dominance stablecoins : ${ctx.stablecoins.dominance_pct} % de la capitalisation totale du marché crypto.`);
  }
  if (ctx && ctx.employment_us && ctx.employment_us.unemployment_rate_pct != null) {
    parts.push(`Emploi US : chômage ${ctx.employment_us.unemployment_rate_pct} %, variation non-agricole ${ctx.employment_us.nonfarm_payrolls_change_k ?? "—"}k (rapport du ${ctx.employment_us.last_report_date || "—"}).`);
  }
  if (ctx && ctx.etf_flows && ctx.etf_flows.btc_etf_net_flow_usd != null) {
    const flowM = ctx.etf_flows.btc_etf_net_flow_usd / 1e6;
    parts.push(`ETF Bitcoin spot : flux net ${flowM >= 0 ? "+" : ""}${flowM.toFixed(1)} M$ (${ctx.etf_flows.period || "période récente"}).`);
  }

  // Répartition des verdicts actifs sur les 15 favoris — signal d'ensemble utile pour une
  // question générale ("le marché est-il plutôt à l'achat en ce moment ?") sans devoir lister
  // les 15 verdicts un par un (voir la même logique de dernier-verdict-par-actif que answerEngine).
  const verdicts = chatData.verdicts || [];
  if (verdicts.length) {
    const latestByAsset = new Map();
    verdicts.forEach((v) => {
      const prev = latestByAsset.get(v.asset);
      if (!prev || new Date(v.issued_at) > new Date(prev.issued_at)) latestByAsset.set(v.asset, v);
    });
    const counts = { ACHAT: 0, ATTENTE: 0, VENTE: 0 };
    latestByAsset.forEach((v) => { if (counts[v.verdict] !== undefined) counts[v.verdict]++; });
    parts.push(`Répartition des verdicts actifs sur les 15 favoris : ${counts.ACHAT} ACHAT, ${counts.ATTENTE} ATTENTE, ${counts.VENTE} VENTE.`);
  }

  const stats = chatData.engineHistory && chatData.engineHistory.global_stats;
  if (stats && stats.accuracy_strict_pct != null) {
    parts.push(`Fiabilité mesurée du moteur : ${stats.accuracy_strict_pct.toFixed(1)} % d'exactitude sur ${stats.total_verdicts_resolved} verdicts vérifiés.`);
  }

  const opps = ((chatData.opportunities && chatData.opportunities.opportunities) || []).slice(0, 3);
  if (opps.length) parts.push("Top opportunités suivies : " + opps.map((o) => `${o.ticker} (${o.reason || "—"})`).join(" ; "));
  const alerts = (chatData.alerts || []).slice(-3);
  if (alerts.length) parts.push("Dernières alertes : " + alerts.map((a) => a.message).join(" ; "));
  return parts.join("\n");
}

// Dernier recours absolu quand rien d'autre (actif suivi, glossaire, recherche live, intentions)
// n'a répondu — appelle le relais IA gratuit (cloudflare-worker/, Cloudflare Workers AI, voir
// AI_RELAY_URL dans config.js) avec les vraies données du site en contexte. Best-effort comme
// fetchLiveTechnicalSummary/fetchLiveSearchAnswer : tant que AI_RELAY_URL n'est pas configuré
// (placeholder par défaut), ou si l'appel échoue/traîne, retombe silencieusement sur le message
// générique existant — ne peut donc jamais faire régresser un cas qui marchait déjà.
async function fetchLiveAiFallback(question) {
  if (!AI_RELAY_URL || AI_RELAY_URL.includes("REMPLACE-MOI")) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(AI_RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, context: buildAiContext() }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.answer) return null;
    return `${data.answer}\n\n(Réponse générée par IA à partir des données du site — pas un verdict vérifié du moteur.)`;
  } catch (e) {
    return null;
  }
}

// Recherche en direct d'un actif nommé mais non suivi (ni favori ni opportunité) — une donnée
// factuelle sourcée (CoinGecko), jamais une supposition. Reste prioritaire sur l'IA générale
// pour la même raison qu'un actif suivi ou une définition de glossaire : buildAiContext() ne
// contient PAS cette donnée, donc l'IA ne pourrait que deviner ou refuser de répondre, alors
// qu'une vraie recherche CoinGecko donne un chiffre exact. "approximatif" au sens propre : un
// nom propre capitalisé peut apparaître dans une phrase sans rapport (ex. "Twitter" cité en
// passant) — d'où rememberAssetCandidate, réutilisé par answerQuestion pour le message final
// "pas suivi" seulement si rien d'autre (y compris l'IA) n'a pu répondre.
async function tryLiveAssetSearch(question, rememberAssetCandidate) {
  const assetQuery = extractAssetQuery(question);
  if (!assetQuery) return null;
  rememberAssetCandidate(assetQuery);
  return await fetchLiveSearchAnswer(assetQuery);
}

// Dernier filet, seulement si l'IA est indisponible (AI_RELAY_URL non configuré) ou échoue
// (réseau, timeout) — voir answerQuestion. Un mot-clé isolé reste préférable à rien, mais ne
// doit JAMAIS passer avant une vraie lecture par l'IA : c'est exactement le bug remonté par
// l'utilisateur ("il répond automatiquement sans rien analyser") — un mot-clé matchait (ou,
// pire, aucun ne matchait, ex. "bullrun") avant que la question ait la moindre chance d'être
// vraiment comprise.
function tryKeywordFallback(norm) {
  const intent = CHAT_INTENTS.find((i) => i.keywords.some((k) => norm.includes(k)));
  return intent ? intent.handler() : null;
}

async function answerQuestion(question) {
  await ensureChatData();
  const norm = question.toLowerCase();

  // Actif suivi nommément, définition de glossaire, ou recherche CoinGecko en direct sur un nom
  // d'actif repéré : trois cas où une vraie donnée sourcée existe, à privilégier sur une réponse
  // IA générale qui n'y a pas accès (voir buildAiContext). Inchangé par la réorganisation ci-dessous.
  const mention = findAssetMention(question);
  if (mention) return await answerAboutAsset(mention, question);

  const glossaryHit = findGlossaryTerm(question);
  if (glossaryHit) return `${glossaryHit.term} : ${glossaryHit.definition}`;

  let assetCandidate = null;
  const liveSearch = await tryLiveAssetSearch(question, (q) => { assetCandidate = q; });
  if (liveSearch) return liveSearch;

  // Pour tout le reste — question générale, analytique, conversationnelle ("on est en bullrun ?",
  // "pourquoi ça monte", une phrase longue et nuancée... ) — l'IA passe TOUJOURS en premier,
  // quelle que soit la longueur de la question : un texte court mérite une vraie lecture autant
  // qu'un texte long. Le mot-clé (CHAT_INTENTS) ne sert plus que de filet si l'IA est
  // indisponible ou échoue (voir fetchLiveAiFallback, qui reste silencieux et sans coût tant
  // qu'AI_RELAY_URL n'est pas configuré — aucune régression du comportement "site autonome").
  const aiAnswer = await fetchLiveAiFallback(question);
  if (aiAnswer) return aiAnswer;

  const keywordAnswer = tryKeywordFallback(norm);
  if (keywordAnswer) return keywordAnswer;

  if (assetCandidate || looksLikeUnknownAssetMention(question)) {
    return `Je ne trouve pas cet actif parmi les 15 favoris ou les opportunités suivies, donc pas de verdict du moteur dessus. Utilise la recherche de l'onglet Favoris pour son prix et sa fiche d'identité en direct — tape simplement son nom.`;
  }

  return `Je réponds à partir de ce que le radar a déjà analysé : le résumé du moment, un actif suivi (favori ou opportunité), les meilleures opportunités, les dernières alertes, ou la performance du moteur.\n\nEssaie par exemple : "résume-moi la semaine", "pourquoi le marché est neutre", ou "que penses-tu de Chainlink".`;
}

function appendChatMessage(role, text) {
  const log = document.getElementById("chat-log");
  if (!log) return null;
  const el = document.createElement("div");
  el.className = `chat-msg chat-msg--${role}`;
  const p = document.createElement("p");
  p.textContent = text;
  el.appendChild(p);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

// Trois points qui pulsent l'un après l'autre plutôt qu'un simple "…" statique — l'assistant
// peut vraiment prendre plusieurs secondes le temps d'un appel IA (voir fetchLiveAiFallback),
// un indicateur immobile donnait l'impression d'une réponse instantanée toute faite même quand
// ce n'était pas le cas.
function appendTypingIndicator() {
  const log = document.getElementById("chat-log");
  if (!log) return null;
  const el = document.createElement("div");
  el.className = "chat-msg chat-msg--assistant chat-msg--typing";
  el.innerHTML = `<p><span class="chat-typing-dots"><span></span><span></span><span></span></span></p>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

const CHAT_SUGGESTIONS = [
  "Résume-moi la semaine",
  "Pourquoi le marché est-il neutre en ce moment ?",
  "Quelles sont les meilleures opportunités ?",
  "Que penses-tu de Bitcoin ?",
  "Quelles sont les dernières alertes ?",
  "Tu connais Worldcoin ?",
];

function renderChatSuggestions() {
  const el = document.getElementById("chat-suggestions");
  if (!el) return;
  el.innerHTML = CHAT_SUGGESTIONS.map((s) => `<button type="button" class="chat-suggestion-chip">${escapeHtml(s)}</button>`).join("");
  el.querySelectorAll(".chat-suggestion-chip").forEach((btn) => {
    btn.addEventListener("click", () => submitChatQuestion(btn.textContent));
  });
}

let chatBusy = false;
async function submitChatQuestion(question) {
  if (!question || !question.trim() || chatBusy) return;
  chatBusy = true;
  appendChatMessage("user", question);
  const input = document.getElementById("chat-input");
  if (input) input.value = "";
  const typingEl = appendTypingIndicator();
  try {
    const answer = await answerQuestion(question);
    if (typingEl) typingEl.remove();
    appendChatMessage("assistant", answer);
  } catch (err) {
    console.error("Erreur assistant :", err);
    if (typingEl) typingEl.remove();
    appendChatMessage("assistant", "Une erreur empêche de répondre pour l'instant — réessaie dans un instant.");
  } finally {
    chatBusy = false;
  }
}

let assistantInitDone = false;
function initAssistant() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  if (!form || assistantInitDone) return;
  assistantInitDone = true;
  renderChatSuggestions();
  appendChatMessage(
    "assistant",
    "Salut ! Je réponds à partir des dernières analyses calculées par le radar (mises à jour toutes les 2h) — pose une question sur le marché, un actif suivi, les opportunités ou les dernières alertes. Sur un actif précis, j'ajoute aussi des indicateurs techniques (RSI, tendance, volume) calculés en direct, pas seulement le dernier verdict. Et si tu nommes un actif que je ne suis pas, je vais quand même chercher son prix en direct sur CoinGecko plutôt que de te renvoyer vers la recherche."
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitChatQuestion(input.value);
  });
}
