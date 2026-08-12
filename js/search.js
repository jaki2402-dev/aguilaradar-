// Recherche libre de n'importe quel actif (dans ou hors Top 300) — consultation instantanée,
// pas un verdict engagé, donc pas de filtre memecoin ici (c'est un lookup, pas une recommandation).

async function searchCoinByName(query) {
  const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = await res.json();
  return data.coins || [];
}

async function fetchCoinDetail(id) {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&ids=${id}&price_change_percentage=24h,7d,30d`
  );
  if (!res.ok) throw new Error(`markets ${res.status}`);
  const data = await res.json();
  return data[0];
}

function renderSearchResult(coin) {
  const el = document.getElementById("search-result");
  if (!coin) {
    el.innerHTML = `<p class="empty-state">Aucun résultat.</p>`;
    return;
  }
  const change24h = coin.price_change_percentage_24h_in_currency;
  el.innerHTML = `
    <div class="favori-card">
      <div class="favori-header">
        <div><span class="favori-ticker">${escapeHtml((coin.symbol || "").toUpperCase())}</span><span class="favori-name">${escapeHtml(coin.name)}</span></div>
        <div class="favori-price">${formatPrice(coin.current_price, "EUR")}</div>
      </div>
      <div class="chip ${change24h >= 0 ? "positive" : "negative"}">${formatChangePct(change24h)}</div>
      <p class="hint">7j : ${formatChangePct(coin.price_change_percentage_7d_in_currency)} · 30j : ${formatChangePct(coin.price_change_percentage_30d_in_currency)} · Rang capitalisation #${coin.market_cap_rank ?? "—"}</p>
      <div class="tv-chart" id="tv-search-result"></div>
      <p class="hint">Consultation libre — ne fait pas partie du criblage d'opportunités ni des verdicts suivis dans le temps.</p>
    </div>`;
  mountTradingViewChart("tv-search-result", `BINANCE:${(coin.symbol || "").toUpperCase()}USDT`);
}

async function handleSearchSubmit(query) {
  const el = document.getElementById("search-result");
  if (!query || !query.trim()) return;
  el.innerHTML = `<p class="empty-state">Recherche en cours…</p>`;
  try {
    const matches = await searchCoinByName(query.trim());
    if (matches.length === 0) {
      el.innerHTML = `<p class="empty-state">Aucun résultat pour "${escapeHtml(query)}".</p>`;
      return;
    }
    const detail = await fetchCoinDetail(matches[0].id);
    renderSearchResult(detail);
  } catch (err) {
    console.error("Erreur de recherche :", err);
    el.innerHTML = `<p class="empty-state">Recherche indisponible pour l'instant (limite CoinGecko probable) — réessaie dans une minute.</p>`;
  }
}

function initSearch() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSearchSubmit(input.value);
  });
}
