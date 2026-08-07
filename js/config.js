// Configuration centrale — modifier ici, jamais en dur ailleurs dans le code.

// Hash SHA-256 du code d'accès (voir README "Portail d'accès" pour les limites réelles
// de cette protection — le dépôt est public, ce n'est pas une vraie sécurité).
const ACCESS_HASH = "0a23403368cf9a89e31f7d79caef03b54333541471de0488745eb26f20bbf5d6";
const ACCESS_STORAGE_KEY = "aguilaradar_access_ok";

// Les 15 favoris. IDs CoinGecko vérifiés via /api/v3/search (règle : ne jamais deviner).
// Symboles TradingView = meilleure estimation d'exchange liquide ; un symbole invalide
// affiche une erreur visible dans le widget (jamais une fausse donnée) — à corriger au
// premier lancement visuel si besoin.
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

const REFRESH = {
  quantCycleMinutes: 10, // pouls rapide : prix / seuils / alertes, sans raisonnement IA
  deepCycleHours: 2,     // cycle profond : verdicts, actus, mise à jour du moteur
};

// Seuil UNIQUE de "mouvement directionnel", utilisé partout (backtest, confusion matrix,
// évaluation des verdicts neutres). Ne jamais faire varier ce seuil d'un tableau à l'autre.
const THRESHOLDS = {
  directionalMovePct: 5,
};

const DATA_URLS = {
  verdicts: "data/verdicts.json",
  engineHistory: "data/engine-history.json",
  opportunities: "data/opportunities.json",
  alerts: "data/alerts.json",
  news: "data/news.json",
  controlGroup: "data/control-group.json",
  marketContext: "data/market-context.json",
};
