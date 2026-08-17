// Recherche libre de n'importe quel actif (dans ou hors Top 300) — consultation instantanée.
// Si l'actif cherché fait partie des 15 favoris ou du criblage Top 300 (Opportunités), affiche
// le vrai verdict/raisonnement déjà calculé par le moteur au lieu d'une simple carte de prix.
// Sinon, fiche d'identité factuelle (description, catégorie, lien officiel) en plus du prix —
// jamais de faux semblant d'analyse sur un actif que le moteur ne suit pas.

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

// Uniquement pour un actif non suivi (pas de verdict/opportunité) — évite un appel réseau
// supplémentaire inutile quand une vraie analyse existe déjà.
async function fetchCoinFullInfo(id) {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`
  );
  if (!res.ok) throw new Error(`info ${res.status}`);
  return await res.json();
}

function findLatestVerdict(verdicts, cgId) {
  return (
    (verdicts || [])
      .filter((v) => v.asset === cgId)
      .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))[0] || null
  );
}

function findOpportunity(opportunitiesData, cgId) {
  return ((opportunitiesData && opportunitiesData.opportunities) || []).find((o) => o.cgId === cgId) || null;
}

function renderTrackedVerdictResult(coin, verdict) {
  const el = document.getElementById("search-result");
  const change24h = coin.price_change_percentage_24h_in_currency;
  const panelId = "detail-search-verdict";
  el.innerHTML = `
    <div class="favori-card clickable" data-detail-target="${panelId}">
      <div class="favori-header">
        <div><span class="favori-ticker">${escapeHtml((coin.symbol || "").toUpperCase())}</span><span class="favori-name">${escapeHtml(coin.name)}</span></div>
        <span class="badge badge-${escapeHtml(verdict.verdict.toLowerCase())}">${escapeHtml(verdict.verdict)}</span>
      </div>
      <div class="favori-price">${formatPrice(coin.current_price, "EUR")}</div>
      <div class="chip ${change24h >= 0 ? "positive" : "negative"}">${formatChangePct(change24h)}</div>
      <p class="hint">7j : ${formatChangePct(coin.price_change_percentage_7d_in_currency)} · 30j : ${formatChangePct(coin.price_change_percentage_30d_in_currency)} · Rang capitalisation #${coin.market_cap_rank ?? "—"}</p>
      <p style="margin-top:10px;">${escapeHtml(verdict.reasoning || "")}</p>
      <p class="hint">Confiance ${verdict.confidence_pct ?? "—"} % · horizon ${verdict.horizon_days} j · statut ${verdict.status}</p>
      <div class="tv-chart" id="tv-search-result"></div>
      <p class="hint">Fait partie des 15 favoris suivis — verdict du moteur d'analyse, mis à jour au fil des cycles.</p>
      <div class="expand-hint">Voir l'analyse détaillée <span class="chevron">▾</span></div>
      <div class="detail-panel" id="${panelId}"></div>
    </div>`;
  mountTradingViewChart("tv-search-result", `BINANCE:${(coin.symbol || "").toUpperCase()}USDT`);
  const cardEl = el.querySelector(".favori-card.clickable");
  if (cardEl && window.attachDetailToggle) {
    attachDetailToggle(cardEl, panelId, {
      cgId: verdict.asset,
      tvSymbol: null,
      athChangePct: null,
      reasoning: verdict.reasoning,
      verdict: verdict.verdict,
    });
  }
}

function renderTrackedOpportunityResult(opportunity) {
  const el = document.getElementById("search-result");
  const panelId = `detail-opp-search-result-${opportunity.id || 0}`;
  el.innerHTML =
    renderOpportunityCard(opportunity, 0, "search-result") +
    `<p class="hint" style="margin-top:8px;">Fait partie du criblage Top 300 (onglet Opportunités) — analyse et suivi déjà en cours.</p>`;
  const cardEl = el.querySelector(".opp-card.clickable");
  if (cardEl && window.attachDetailToggle) {
    attachDetailToggle(cardEl, panelId, {
      cgId: opportunity.cgId,
      athChangePct: opportunity.ath_change_pct ?? null,
      reasoning: opportunity.reason || "",
      tvSymbol: null,
      horizons: opportunity.horizons,
    });
  }
}

async function renderUntrackedResult(coin) {
  const el = document.getElementById("search-result");
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
      <div id="search-fiche-identite"><p class="hint">Chargement de la fiche d'identité…</p></div>
      <p class="hint">Non suivi par le moteur — pas de verdict ni de criblage sur cet actif, uniquement les données publiques ci-dessous.</p>
    </div>`;
  mountTradingViewChart("tv-search-result", `BINANCE:${(coin.symbol || "").toUpperCase()}USDT`);

  const ficheEl = document.getElementById("search-fiche-identite");
  try {
    const info = await fetchCoinFullInfo(coin.id);
    const desc = (info.description && (info.description.fr || info.description.en)) || "";
    const shortDesc = desc ? desc.split(/\r?\n/)[0].slice(0, 400) : "";
    const categories = (info.categories || []).filter(Boolean).slice(0, 4);
    const homepage = safeUrl(info.links && info.links.homepage && info.links.homepage[0]);
    if (!ficheEl) return;
    ficheEl.innerHTML = `
      ${categories.length ? `<div class="opp-tags" style="margin-top:8px;">${categories.map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join("")}</div>` : ""}
      ${shortDesc ? `<p style="margin-top:8px;">${escapeHtml(shortDesc)}${desc.length > 400 ? "…" : ""}</p>` : ""}
      ${homepage ? `<p class="hint" style="margin-top:6px;"><a href="${escapeHtml(homepage)}" target="_blank" rel="noopener noreferrer">Site officiel</a></p>` : ""}
    `;
  } catch (err) {
    console.error("Fiche d'identité indisponible :", err);
    if (ficheEl) ficheEl.innerHTML = "";
  }
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
    const matchId = matches[0].id;
    const [detail, verdicts, opportunitiesData] = await Promise.all([
      fetchCoinDetail(matchId),
      loadJson(DATA_URLS.verdicts),
      loadJson(DATA_URLS.opportunities),
    ]);
    if (!detail) {
      el.innerHTML = `<p class="empty-state">Aucun résultat.</p>`;
      return;
    }
    const verdict = findLatestVerdict(verdicts, matchId);
    const opportunity = !verdict ? findOpportunity(opportunitiesData, matchId) : null;
    if (verdict) {
      renderTrackedVerdictResult(detail, verdict);
    } else if (opportunity) {
      renderTrackedOpportunityResult(opportunity);
    } else {
      await renderUntrackedResult(detail);
    }
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
