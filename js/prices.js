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
