// Configuration centrale — modifier ici, jamais en dur ailleurs dans le code.

// Échappement HTML pour tout texte affiché qui vient d'une source externe/moins fiable
// (actus web, résumés IA, API CoinGecko publique) — ces fichiers/API ne sont jamais garantis
// exempts de caractères HTML, donc jamais interpolés bruts dans innerHTML.
const HTML_ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]);
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
const FAVORIS = [
  { ticker: "BTC",  name: "Bitcoin",                          cgId: "bitcoin",                              tvSymbol: "BINANCE:BTCUSDT" },
  { ticker: "ETH",  name: "Ethereum",                         cgId: "ethereum",                             tvSymbol: "BINANCE:ETHUSDT" },
  { ticker: "FET",  name: "Artificial Superintelligence Alliance", cgId: "fetch-ai",                              tvSymbol: "BINANCE:FETUSDT" },
  { ticker: "GRT",  name: "The Graph",                        cgId: "the-graph",                            tvSymbol: "BINANCE:GRTUSDT" },
  { ticker: "TIA",  name: "Celestia",                         cgId: "celestia",                             tvSymbol: "BINANCE:TIAUSDT" },
  { ticker: "CTSI", name: "Cartesi",                          cgId: "cartesi",                              tvSymbol: "BINANCE:CTSIUSDT" },
  { ticker: "PEAQ", name: "Peaq",                             cgId: "peaq-2",                               tvSymbol: "MEXC:PEAQUSDT" },
  { ticker: "LINK", name: "Chainlink",                        cgId: "chainlink",                            tvSymbol: "BINANCE:LINKUSDT" },
  { ticker: "ONDO", name: "Ondo Finance",                     cgId: "ondo-finance",                         tvSymbol: "BINANCE:ONDOUSDT" },
  { ticker: "JUP",  name: "Jupiter",                          cgId: "jupiter-exchange-solana",              tvSymbol: "BINANCE:JUPUSDT" },
  { ticker: "LPT",  name: "Livepeer",                         cgId: "livepeer",                             tvSymbol: "BINANCE:LPTUSDT" },
  { ticker: "AIOZ", name: "AIOZ Network",                     cgId: "aioz-network",                         tvSymbol: "GATEIO:AIOZUSDT" },
  { ticker: "FLUX", name: "Flux",                             cgId: "zelcash",                              tvSymbol: "BINANCE:FLUXUSDT" },
  { ticker: "ARB",  name: "Arbitrum",                         cgId: "arbitrum",                             tvSymbol: "BINANCE:ARBUSDT" },
  { ticker: "INJ",  name: "Injective",                        cgId: "injective-protocol",                   tvSymbol: "BINANCE:INJUSDT" },
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

const REFRESH = {
  quantCycleMinutes: 10, // pouls rapide : prix / seuils / alertes, sans raisonnement IA
  deepCycleHours: 2,     // cycle profond : verdicts, actus, mise à jour du moteur
};

// Seuil UNIQUE de "mouvement directionnel", utilisé partout (backtest, confusion matrix,
// évaluation des verdicts neutres). Ne jamais faire varier ce seuil d'un tableau à l'autre.
const THRESHOLDS = {
  directionalMovePct: 5,
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
];

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
};
