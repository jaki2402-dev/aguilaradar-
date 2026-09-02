// Configuration centrale — modifier ici, jamais en dur ailleurs dans le code.

// Échappement HTML pour tout texte affiché qui vient d'une source externe/moins fiable
// (actus web, résumés IA, API CoinGecko publique) — ces fichiers/API ne sont jamais garantis
// exempts de caractères HTML, donc jamais interpolés bruts dans innerHTML.
const HTML_ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]);
}

// Met en évidence les chiffres-clés (%, $, €) et les repères de scénario Bull/Base/Bear dans un
// texte d'analyse long (thèse hebdo de portfolio-thesis.json, raisonnement du moteur) — ces
// paragraphes de plusieurs phrases noient l'info dense au milieu de la prose, ce qui les rend
// difficiles à scanner d'un coup d'oeil sur mobile. Échappe toujours en premier via escapeHtml
// ci-dessus puis n'ajoute que des balises fixes autour du texte déjà échappé (jamais de HTML
// réinjecté depuis la donnée elle-même) : un remplacement direct de escapeHtml(x) par
// highlightKeyInfo(x) sur un call site existant reste donc tout aussi sûr. <span> et jamais
// <strong> pour le repère de scénario : plusieurs blocs du site (.detail-opinion strong,
// .disclaimer-box strong...) stylent déjà TOUT <strong> en label de bloc (display:block) — un
// <strong> ici serait coupé en pleine phrase au lieu de rester en ligne.
// Motif numérique "à la française" : groupes de milliers séparés par une espace (12 775),
// décimale en virgule ou point (1,1 / 10.7) — jamais un simple \d+ avec virgule/point/espace
// en vrac, qui coupait un nombre décimal en deux (ex-bug vérifié ici : "1,1 %" ne surlignait
// que "1 %" en traitant la virgule comme un séparateur de milliers exigeant 2-3 chiffres).
const HIGHLIGHT_KEY_INFO_RE = /\b(Bull|Bear|Base)\s*:|[$€£]\s?\d{1,3}(?:\s\d{3})*(?:[.,]\d+)?|\d{1,3}(?:\s\d{3})*(?:[.,]\d+)?\s?(?:%|€|\$|dollars?\b|euros?\b)/g;
function highlightKeyInfo(text) {
  const safe = escapeHtml(text || "");
  return safe.replace(HIGHLIGHT_KEY_INFO_RE, (match, scenarioWord) => {
    if (scenarioWord) {
      const cls = scenarioWord === "Bull" ? "hl-bull" : scenarioWord === "Bear" ? "hl-bear" : "hl-base";
      return `<span class="hl-scenario ${cls}">${match}</span>`;
    }
    return `<mark class="hl-stat">${match}</mark>`;
  });
}

// N'autorise que http(s) pour toute URL affichée en attribut href — bloque les schémas
// javascript:/data: qu'un champ texte externe (actu, contexte favori) pourrait contenir.
function safeUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url, window.location.href);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch (e) {
    return null;
  }
}

// Hash SHA-256 du code d'accès (voir README "Portail d'accès" pour les limites réelles
// de cette protection — le dépôt est public, ce n'est pas une vraie sécurité).
const ACCESS_HASH = "0a23403368cf9a89e31f7d79caef03b54333541471de0488745eb26f20bbf5d6";

// Les 15 favoris. IDs CoinGecko vérifiés via /api/v3/search (règle : ne jamais deviner).
// Symboles TradingView = meilleure estimation d'exchange liquide ; un symbole invalide
// affiche une erreur visible dans le widget (jamais une fausse donnée). Vérifié le
// 2026-08-17 : les 15 paires existent et sont liquides sur leur exchange (Binance pour
// la majorité, MEXC pour PEAQ, Gate.io pour AIOZ) — à revérifier seulement si un widget
// affiche un jour une erreur (nouveau listing renommé, paire délistée, etc.).
// utility : à quoi sert réellement le TOKEN (pas juste le projet) — rédigé à partir de
// get-coin-info (CoinGecko, description officielle du projet) le 31/08/2026, complété par une
// recherche web ciblée pour ARB/INJ (mécanique de tokenomics non couverte par la description
// CoinGecko : ARB reste un jeton de gouvernance pur, le gas d'Arbitrum se paie en ETH — pas un
// détail anecdotique, une confusion fréquente ; INJ finance une enchère de rachat/destruction
// hebdomadaire, 60% des frais d'échange). Fait ponctuel et factuel (comment le jeton capture de
// la valeur), pas une donnée de marché — n'a donc pas besoin d'être réactualisé par une routine,
// contrairement à market-context.json plus haut. Jamais un avis d'investissement.
const FAVORIS = [
  { ticker: "BTC",  name: "Bitcoin",                          cgId: "bitcoin",                              tvSymbol: "BINANCE:BTCUSDT", utility: "Monnaie numérique pair-à-pair à offre fixe (21 millions) : sert de réserve de valeur et de moyen de paiement décentralisé, sans smart contracts natifs ni autre utilité applicative." },
  { ticker: "ETH",  name: "Ethereum",                         cgId: "ethereum",                             tvSymbol: "BINANCE:ETHUSDT", utility: "Carburant (gas) du plus grand réseau de smart contracts : chaque transaction ou interaction avec une dApp consomme de l'ETH, également mis en jeu (staking) par les validateurs pour sécuriser le réseau depuis le passage en Proof of Stake." },
  { ticker: "FET",  name: "Artificial Superintelligence Alliance", cgId: "fetch-ai",                              tvSymbol: "BINANCE:FETUSDT", aliases: ["fetch.ai", "fetch ai", "fetchai", "fetch"], utility: "Jeton unique de l'alliance ASI (fusion de FET, AGIX et OCEAN) : paie les services d'agents IA autonomes et de calcul décentralisé sur le réseau, et sert de jeton de gouvernance de l'alliance." },
  { ticker: "GRT",  name: "The Graph",                        cgId: "the-graph",                            tvSymbol: "BINANCE:GRTUSDT", utility: "Jeton d'un réseau d'indexation de données blockchain : les Indexers le mettent en jeu (stake) pour indexer et servir des requêtes GraphQL, les Curators le stakent pour signaler les sous-graphes utiles, et les requêtes API sont payées en GRT." },
  { ticker: "TIA",  name: "Celestia",                         cgId: "celestia",                             tvSymbol: "BINANCE:TIAUSDT", utility: "Jeton de sécurité et de frais d'un réseau de disponibilité des données (data availability) : les validateurs le mettent en jeu pour sécuriser le réseau, et les rollups modulaires paient en TIA pour y publier leurs données." },
  { ticker: "CTSI", name: "Cartesi",                          cgId: "cartesi",                              tvSymbol: "BINANCE:CTSIUSDT", utility: "Jeton de frais et de mise en jeu d'un réseau de rollups permettant d'exécuter du code standard (Linux) avec la sécurité d'Ethereum : rémunère le calcul off-chain fourni par les nœuds." },
  { ticker: "PEAQ", name: "Peaq",                             cgId: "peaq-2",                               tvSymbol: "MEXC:PEAQUSDT", utility: "Jeton d'un réseau layer-1 pour machines et robots (DePIN) : sert à l'identité vérifiable et au paiement entre machines autonomes (véhicules, capteurs, robots), et à la sécurisation du réseau via staking." },
  { ticker: "LINK", name: "Chainlink",                        cgId: "chainlink",                            tvSymbol: "BINANCE:LINKUSDT", utility: "Jeton du plus grand réseau d'oracles décentralisés : rémunère les nœuds qui livrent des données externes fiables aux smart contracts (prix, événements, calculs off-chain), et sert de collatéral de staking garantissant leur bon comportement." },
  { ticker: "ONDO", name: "Ondo Finance",                     cgId: "ondo-finance",                         tvSymbol: "BINANCE:ONDOUSDT", utility: "Jeton de gouvernance de la fondation Ondo, qui tokenise des actifs financiers traditionnels (obligations d'État américaines, etc.) : donne un droit de vote sur le protocole, pas un droit sur les rendements des produits tokenisés eux-mêmes." },
  { ticker: "JUP",  name: "Jupiter",                          cgId: "jupiter-exchange-solana",              tvSymbol: "BINANCE:JUPUSDT", utility: "Jeton de gouvernance et d'incitation du principal agrégateur d'échange (DEX) sur Solana : vote sur les paramètres du protocole et capture une partie de ses frais." },
  { ticker: "LPT",  name: "Livepeer",                         cgId: "livepeer",                             tvSymbol: "BINANCE:LPTUSDT", utility: "Jeton de mise en jeu d'un réseau de streaming vidéo décentralisé : les orchestrateurs le stakent pour être sélectionnés et rémunérés en transcodant la vidéo, les délégateurs le stakent pour partager leurs gains." },
  { ticker: "AIOZ", name: "AIOZ Network",                     cgId: "aioz-network",                         tvSymbol: "GATEIO:AIOZUSDT", utility: "Jeton d'un réseau DePIN de stockage, streaming et calcul IA décentralisé : rémunère les participants qui partagent bande passante, stockage et puissance de calcul, et sert de collatéral de staking pour les nœuds." },
  { ticker: "FLUX", name: "Flux",                             cgId: "zelcash",                              tvSymbol: "BINANCE:FLUXUSDT", aliases: ["zelcash"], utility: "Jeton multi-usage d'un réseau d'infrastructure décentralisée (cloud Web3) : paie les ressources de calcul, collatéralise les nœuds (FluxNodes) et rémunère mineurs et opérateurs de nœuds." },
  { ticker: "ARB",  name: "Arbitrum",                         cgId: "arbitrum",                             tvSymbol: "BINANCE:ARBUSDT", utility: "Jeton de gouvernance pur du plus grand rollup optimistic Ethereum (L2) : vote sur les paramètres du protocole et l'usage du trésor de la fondation — les frais de transaction restent payés en ETH, pas en ARB." },
  { ticker: "INJ",  name: "Injective",                        cgId: "injective-protocol",                   tvSymbol: "BINANCE:INJUSDT", utility: "Jeton de sécurité (staking des validateurs), de gouvernance et de frais d'un layer-1 dédié à la finance décentralisée : 60% des frais d'échange du réseau servent chaque semaine à racheter et brûler de l'INJ." },
];

// Secteurs des 15 favoris — classification publique factuelle, utilisée pour repérer une
// concentration invisible actif par actif (ex: plusieurs positions "IA" qui bougent ensemble).
const SECTORS = {
  bitcoin: "Réserve de valeur",
  ethereum: "Plateforme L1",
  "fetch-ai": "IA",
  "the-graph": "IA / Indexation",
  celestia: "Infra modulaire",
  cartesi: "Infra modulaire",
  "peaq-2": "DePIN",
  chainlink: "Oracle",
  "ondo-finance": "RWA",
  "jupiter-exchange-solana": "DEX",
  livepeer: "IA / Infra vidéo",
  "aioz-network": "DePIN / Stockage",
  zelcash: "DePIN / Cloud",
  arbitrum: "L2",
  "injective-protocol": "DeFi L1",
};

// Regroupement des secteurs en 5 familles pour le liseré de couleur des favoris — réutilise
// les couleurs d'identité déjà utilisées ailleurs (nav, icônes de section) plutôt que d'en
// inventer de nouvelles, pour rester cohérent avec le reste du site.
const SECTOR_COLORS = {
  bitcoin: "#f0b429", // réserve de valeur
  ethereum: "#7c9eff", // infra L1/L2/DeFi
  arbitrum: "#7c9eff",
  "injective-protocol": "#7c9eff",
  "fetch-ai": "#22b8e0", // IA
  "the-graph": "#22b8e0",
  livepeer: "#22b8e0",
  celestia: "#b48cf2", // infra modulaire / DePIN
  cartesi: "#b48cf2",
  "peaq-2": "#b48cf2",
  "aioz-network": "#b48cf2",
  zelcash: "#b48cf2",
  chainlink: "#fb8362", // oracle / RWA / DEX
  "ondo-finance": "#fb8362",
  "jupiter-exchange-solana": "#fb8362",
};

// Même regroupement en 5 familles que les commentaires ci-dessus sur SECTOR_COLORS (une couleur
// = une famille), mais exposé ici comme un vrai texte plutôt que seulement un commentaire JS —
// utilisé par renderPortfolioConcentration (portfolio.js) pour juger la concentration RÉELLE
// (pondérée en euros) du portefeuille. Délibérément plus grossier que SECTORS ci-dessus, qui
// distingue "IA", "IA / Indexation" et "IA / Infra vidéo" comme 3 secteurs séparés — pertinent
// pour cartographier la diversité des 15 favoris sur l'Accueil (renderSectorBreakdown,
// insights.js), mais pas pour une question de RISQUE sur de l'argent réel : FET/GRT/LPT sont le
// même pari si le narratif IA se dégonfle, peu importe la sous-niche technique de chacun —
// les compter comme 3 secteurs distincts masquerait une concentration bien réelle.
const SECTOR_FAMILIES = {
  bitcoin: "Réserve de valeur",
  ethereum: "Infra L1/L2/DeFi",
  arbitrum: "Infra L1/L2/DeFi",
  "injective-protocol": "Infra L1/L2/DeFi",
  "fetch-ai": "IA",
  "the-graph": "IA",
  livepeer: "IA",
  celestia: "Infra modulaire / DePIN",
  cartesi: "Infra modulaire / DePIN",
  "peaq-2": "Infra modulaire / DePIN",
  "aioz-network": "Infra modulaire / DePIN",
  zelcash: "Infra modulaire / DePIN",
  chainlink: "Oracle / RWA / DEX",
  "ondo-finance": "Oracle / RWA / DEX",
  "jupiter-exchange-solana": "Oracle / RWA / DEX",
};

const REFRESH = {
  quantCycleMinutes: 10, // pouls rapide : prix / seuils / alertes, sans raisonnement IA
  deepCycleHours: 2,     // cycle profond : verdicts, actus, mise à jour du moteur
};

// Seuil UNIQUE de "mouvement directionnel", utilisé partout (backtest, confusion matrix,
// évaluation des verdicts neutres). Ne jamais faire varier ce seuil d'un tableau à l'autre.
// concentrationWarningPct : même principe pour l'idée de "concentration excessive" — un seul
// seuil, partagé entre renderSectorBreakdown (insights.js, favoris comptés à égalité) et
// renderPortfolioConcentration (portfolio.js, pondéré en euros réels) — jamais deux chiffres
// différents pour la même alerte.
const THRESHOLDS = {
  directionalMovePct: 5,
  concentrationWarningPct: 30,
};

// Glossaire débutant — même texte que la section repliable "Glossaire débutant" de index.html
// (accueil), dupliqué ici intentionnellement pour que l'Assistant (assistant.js) puisse
// répondre aux questions de définition ("c'est quoi le RSI ?") sans dépendre du DOM de
// l'accueil. Les deux copies doivent rester synchronisées à la main si un terme change.
const GLOSSARY = [
  { term: "Verdict (ACHAT / ATTENTE / VENTE)", definition: "La lecture du moteur sur un actif à un horizon donné — pas un ordre à exécuter, une probabilité." },
  { term: "Confiance", definition: "À quel point le moteur est sûr de son verdict. 70 % de confiance doit être correct environ 70 % du temps sur la durée — voir l'onglet Moteur." },
  { term: "Horizon", definition: "Le délai (en jours) avant qu'un verdict soit vérifié par rapport au prix réel. Avant cette échéance, il reste \"en attente\"." },
  { term: "Seuil directionnel", definition: "Le mouvement de prix minimum (5 % par défaut) pour qu'on considère qu'un actif est vraiment parti dans un sens plutôt que du simple bruit." },
  { term: "RSI", definition: "Indicateur technique (0-100) qui repère un actif \"suracheté\" (proche de 100, risque de reprise de souffle) ou \"survendu\" (proche de 0, rebond possible)." },
  { term: "MM20 / MM50", definition: "Prix moyen des 20 / 50 derniers jours — sert à voir si le prix actuel est au-dessus ou en dessous de sa tendance récente." },
  { term: "ATH", definition: "All-Time High — le plus haut prix historique jamais atteint par l'actif." },
  { term: "Dominance BTC", definition: "La part de Bitcoin dans la capitalisation totale du marché crypto — en hausse, ça signale souvent une préférence pour la sécurité plutôt que la prise de risque." },
  { term: "Indice de peur et de cupidité", definition: "Indicateur de sentiment de marché (0 = peur extrême, 100 = cupidité extrême) — utile pour repérer les excès, pas pour prédire." },
  { term: "Régime de marché", definition: "La tendance de fond actuelle : \"risk-on\" (appétit pour le risque), \"neutre\", ou \"risk-off\" (aversion au risque)." },
  { term: "Signal précoce", definition: "Un mouvement de prix qui va déjà à l'encontre d'un verdict avant même son échéance — un avertissement, pas un résultat final." },
  { term: "Backtest", definition: "La vérification honnête des performances passées du moteur — la matrice de confusion et le taux de réussite dans l'onglet Moteur." },
  { term: "Or (once, USD)", definition: "Le prix au comptant d'une once d'or — valeur refuge de référence, utile pour comparer l'appétit pour le risque entre l'or et le bitcoin." },
  { term: "Taux Fed (cible)", definition: "La fourchette de taux directeur fixée par la banque centrale américaine — un taux qui monte renchérit le crédit et pèse en général sur les actifs risqués comme la crypto." },
  { term: "Trésor US 10 ans", definition: "Le rendement de la dette américaine à 10 ans — une hausse traduit souvent des anticipations de taux plus élevés ou plus durables, un signal macro suivi par les marchés risqués." },
];

// Petite bulle d'aide au survol/focus (accessible clavier, sans JS) réutilisant GLOSSARY comme
// source unique — jamais un 3e texte dupliqué à la main (voir le commentaire au-dessus de
// GLOSSARY sur les 2 copies déjà existantes à synchroniser). Retourne "" si le terme n'existe
// pas dans GLOSSARY plutôt que d'afficher une bulle vide ou un texte inventé.
function glossaryTipHtml(term) {
  const entry = GLOSSARY.find((g) => g.term === term);
  if (!entry) return "";
  return `<span class="info-tip" tabindex="0" role="button" aria-label="Définition : ${escapeHtml(entry.definition)}" data-tip="${escapeHtml(entry.definition)}">?</span>`;
}

// URL du relais IA gratuit (Cloudflare Worker + Workers AI, voir cloudflare-worker/worker.js)
// utilisé par l'Assistant en tout dernier recours, jamais en premier (voir assistant.js). Vide/
// placeholder par défaut : fetchLiveAiFallback le détecte et ne fait alors aucun appel réseau,
// donc le chat marche identiquement à avant tant que le Worker n'est pas déployé. `let`, pas
// `const` : seule valeur de config.js à changer par un humain après coup plutôt qu'à l'ouverture
// du site, doit rester réaffectable (idem latestFavorisPrices dans prices.js).
let AI_RELAY_URL = "https://aguilaradar-assistant-ia.jaki2402.workers.dev/";

// URL de la route d'écriture du portefeuille (même Worker que AI_RELAY_URL, route /transaction —
// voir cloudflare-worker/worker.js) utilisée par renderTransactionCalculator (portfolio.js) pour
// enregistrer une transaction directement dans data/portfolio.json plutôt que par copier-coller
// manuel. Placeholder ("REMPLACE-MOI") par défaut, même mécanique que AI_RELAY_URL avant son
// propre déploiement : tant que ce n'est pas remplacé par la vraie URL, le formulaire retombe sur
// le calcul affiché à copier-coller (comportement actuel, aucune régression) — voir
// renderTransactionCalculator. Ne PAS pointer vers l'URL réelle du Worker avant que la route
// /transaction y soit effectivement déployée (voir cloudflare-worker/README.md) : sans ça, un clic
// sur "Enregistrer" atteindrait le Worker actuel sur une route qu'il ne reconnaît pas encore. `let`
// pour la même raison que AI_RELAY_URL (valeur à changer après coup par un humain).
let PORTFOLIO_WRITE_URL = "REMPLACE-MOI-URL-du-worker/transaction";

const DATA_URLS = {
  verdicts: "data/verdicts.json",
  engineHistory: "data/engine-history.json",
  opportunities: "data/opportunities.json",
  alerts: "data/alerts.json",
  news: "data/news.json",
  controlGroup: "data/control-group.json",
  marketContext: "data/market-context.json",
  favorisContext: "data/favoris-context.json",
  healthLog: "data/health-log.json",
  digest: "data/digest.json",
  portfolio: "data/portfolio.json",
  portfolioThesis: "data/portfolio-thesis.json",
  portfolioHistory: "data/portfolio-history.json",
};
