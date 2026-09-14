// Prix en direct — appel client, aucune automatisation nécessaire (CoinGecko public API).

// Derniers prix connus, partagés avec le reste du site (journal, moteur) pour calculer
// une tendance provisoire sans attendre l'horizon — jamais utilisé pour le vrai backtest.
let latestFavorisPrices = {};

async function fetchFavorisPrices() {
  const ids = FAVORIS.map((f) => f.cgId).join(",");
  // include_market_cap : seul ajout au-delà des champs déjà utilisés (prix/variation 24h) —
  // aucun appel réseau de plus, juste un champ de plus sur la même réponse. Alimente
  // scoreValorisation (js/verdict-breakdown.js), qui n'avait jusqu'ici aucune source de
  // capitalisation pour les favoris (seulement pour les opportunités, opportunities.json).
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,eur&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  return res.json();
}

// Offre en circulation / offre max — appel séparé de fetchFavorisPrices, une fois au chargement
// (pas sur le tick 60s : contrairement au prix, la supply ne bouge pas d'une minute à l'autre).
// /coins/markets (pas /simple/price, qui ne renvoie pas ces champs) — vs_currency n'a aucune
// importance ici, seuls des comptes de jetons (indépendants de toute devise) sont utilisés.
// Alimente scoreTokenomics (js/verdict-breakdown.js), qui retournait toujours null jusqu'ici
// faute de source (voir docs/verdict-methodology.md).
async function fetchFavorisSupply() {
  const ids = FAVORIS.map((f) => f.cgId).join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&sparkline=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const list = await res.json();
  const byId = {};
  list.forEach((c) => {
    byId[c.id] = { circulatingSupply: c.circulating_supply, maxSupply: c.max_supply };
  });
  return byId;
}

function formatPrice(value, currency) {
  if (value === undefined || value === null) return "—";
  const decimals = value < 1 ? 4 : value < 100 ? 3 : 2;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatChangePct(value) {
  if (value === undefined || value === null) return "—";
  const arrow = value >= 0 ? "▲" : "▼";
  const sign = value >= 0 ? "+" : "";
  return `${arrow} ${sign}${value.toFixed(2)} %`;
}
