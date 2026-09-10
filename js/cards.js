// Cartes visuelles riches pour les opportunités (logo, jauge de confiance, mini-graphique
// réel, tags, raisonnement) — même esprit que la grille "pépites du scan" de référence.

function formatMarketCap(value) {
  if (value === undefined || value === null) return "—";
  if (value >= 1e9) return (value / 1e9).toFixed(2) + " Md€";
  if (value >= 1e6) return (value / 1e6).toFixed(1) + " M€";
  return formatPrice(value, "EUR");
}

// Confiance = évaluation indépendante de la qualité (rang, notoriété, caractère extrême du
// mouvement) — volontairement distincte du score de momentum brut, pour ne jamais laisser
// un score élevé (souvent = mouvement extrême et risqué) passer pour une confiance élevée.
function computeConfidence(o) {
  let c = 40;
  if (o.market_cap_rank && o.market_cap_rank <= 100) c += 30;
  if (o.recognized) c += 20;
  if (Math.abs(o.change_7d_pct) < 30) c += 10;
  return Math.min(c, 95);
}

function confidenceColor(value) {
  return value >= 75 ? "var(--gain)" : value >= 55 ? "var(--accent)" : "var(--warning)";
}

function gaugeSvg(value) {
  const r = 24;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - value / 100);
  const color = confidenceColor(value);
  return `
    <svg viewBox="0 0 60 60" class="gauge">
      <circle cx="30" cy="30" r="${r}" class="gauge-bg" />
      <circle cx="30" cy="30" r="${r}" class="gauge-fill" style="stroke:${color}" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" />
      <text x="30" y="35" class="gauge-text">${Math.round(value)}</text>
    </svg>`;
}

function sparklinePoints(values, w, h) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function renderOpportunityCard(o, idx, containerId) {
  const conf = computeConfidence(o);
  const trendUp = o.sparkline && o.sparkline.length > 1 && o.sparkline[o.sparkline.length - 1] >= o.sparkline[0];
  const points = sparklinePoints(o.sparkline, 100, 32);
  // Prefixe par conteneur : la meme pepite peut s'afficher a la fois sur l'Accueil et dans
  // Opportunites — sans ca, deux elements partageraient le meme id et getElementById()
  // ouvrirait toujours la copie cachee de l'autre onglet plutot que celle cliquee.
  const panelId = `detail-opp-${containerId}-${o.id || idx}`;
  return `
    <div class="opp-card clickable" data-detail-target="${panelId}" data-cgid="${o.cgId}" data-ath="${o.ath_change_pct ?? ""}" data-reason="${escapeHtml(o.reason || "")}" data-opp-id="${o.id || o.ticker}">
      <div class="opp-card-top">
        <img src="${safeUrl(o.image) || ""}" alt="" class="opp-logo" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div class="opp-title">
          <div><span class="opp-name">${escapeHtml(o.name)}</span> <span class="opp-ticker-tag">${escapeHtml(o.ticker)}</span></div>
          <span class="hint">Rang capitalisation #${o.market_cap_rank ?? "—"}</span>
        </div>
        ${gaugeSvg(conf)}
      </div>
      <div class="opp-price-row">
        <span class="favori-price">${formatPrice(o.price_eur, "EUR")}</span>
        <span class="chip ${o.change_24h_pct >= 0 ? "positive" : "negative"}">${formatChangePct(o.change_24h_pct)}</span>
      </div>
      ${points ? `<svg class="opp-spark" viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points="${points}" class="spark-line ${trendUp ? "positive" : "negative"}" /></svg>` : ""}
      <div class="opp-tags">
        ${(o.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
        <span class="tag tag-confidence">Confiance ${conf}%</span>
      </div>
      <p class="hint" style="margin-top: 8px;">${highlightKeyInfo(o.reason || "")}</p>
      <div class="opp-footer">
        <span>7j <strong class="${o.change_7d_pct >= 0 ? "positive" : "negative"}">${formatChangePct(o.change_7d_pct)}</strong></span>
        <span>30j <strong class="${o.change_30d_pct >= 0 ? "positive" : "negative"}">${formatChangePct(o.change_30d_pct)}</strong></span>
        <span>Cap. <strong>${formatMarketCap(o.market_cap)}</strong></span>
      </div>
      <div class="expand-hint">Voir l'analyse détaillée <span class="chevron">▾</span></div>
      <div class="detail-panel" id="${panelId}"></div>
    </div>`;
}

// renderOpportunityCard (singulier, ci-dessus) reste utilisé tel quel par la recherche libre
// (search.js, un seul résultat isolé, jamais dans une grille) — seul le pluriel
// renderOpportunityCards (la grille .opp-grid de plusieurs .opp-card) a été retiré le 10/09/2026 :
// son unique appelant (le résumé "Meilleures analyses" de l'Accueil) utilise désormais la même
// tuile compacte que l'onglet Opportunités, voir renderOpportunityTiles ci-dessous.

// Grille dense pour l'onglet Opportunités (esprit Coin360, même logique que .favori-tile) :
// ticker/confiance/prix/variation seulement au premier coup d'oeil, teintée selon la variation
// 24h. Le reste (nom, rang, jauge, mini-graphique, tags, 7j/30j/cap) vit dans .opp-tile-body,
// révélé par pure CSS sur la classe .expanded déjà posée par attachDetailToggle (aucun
// changement necessaire cote detail.js). Les indicateurs vivants (chart, RSI...) restent dans
// .detail-panel comme avant, chargés au clic uniquement. Depuis le 10/09/2026 (voir limit
// optionnel plus bas), sert aussi le résumé "Meilleures analyses" de l'Accueil — même tuile,
// juste limitée aux 3 meilleures, pour ne plus avoir 2 composants différents pour la même info.
function renderOpportunityTile(o, idx, containerId) {
  const conf = computeConfidence(o);
  const trendUp = o.sparkline && o.sparkline.length > 1 && o.sparkline[o.sparkline.length - 1] >= o.sparkline[0];
  const points = sparklinePoints(o.sparkline, 100, 32);
  const panelId = `detail-opptile-${containerId}-${o.id || idx}`;
  return `
    <div class="opp-tile clickable" data-detail-target="${panelId}" data-cgid="${o.cgId}" data-ath="${o.ath_change_pct ?? ""}" data-reason="${escapeHtml(o.reason || "")}" data-opp-id="${o.id || o.ticker}" title="${escapeHtml(o.name)} — Rang capitalisation #${o.market_cap_rank ?? "—"}">
      <div class="favori-tile-head">
        <span class="favori-tile-tick">${escapeHtml(o.ticker)}</span>
        <span class="opp-tile-conf" style="color:${confidenceColor(conf)}">${conf}%</span>
      </div>
      <div class="favori-tile-price">${formatPrice(o.price_eur, "EUR")}</div>
      <div class="favori-tile-change chip ${o.change_24h_pct >= 0 ? "positive" : "negative"}">${formatChangePct(o.change_24h_pct)}</div>
      <div class="expand-hint">Détail <span class="chevron">▾</span></div>

      <div class="opp-tile-body">
        <div class="opp-card-top">
          <img src="${safeUrl(o.image) || ""}" alt="" class="opp-logo" loading="lazy" onerror="this.style.visibility='hidden'" />
          <div class="opp-title">
            <div><span class="opp-name">${escapeHtml(o.name)}</span> <span class="opp-ticker-tag">${escapeHtml(o.ticker)}</span></div>
            <span class="hint">Rang capitalisation #${o.market_cap_rank ?? "—"}</span>
          </div>
          ${gaugeSvg(conf)}
        </div>
        ${points ? `<svg class="opp-spark" viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points="${points}" class="spark-line ${trendUp ? "positive" : "negative"}" /></svg>` : ""}
        <div class="opp-tags">
          ${(o.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
          <span class="tag tag-confidence">Confiance ${conf}%</span>
        </div>
        <div class="opp-footer">
          <span>7j <strong class="${o.change_7d_pct >= 0 ? "positive" : "negative"}">${formatChangePct(o.change_7d_pct)}</strong></span>
          <span>30j <strong class="${o.change_30d_pct >= 0 ? "positive" : "negative"}">${formatChangePct(o.change_30d_pct)}</strong></span>
          <span>Cap. <strong>${formatMarketCap(o.market_cap)}</strong></span>
        </div>
      </div>

      <div class="detail-panel" id="${panelId}"></div>
    </div>`;
}

// Résumé chiffré au-dessus du mur de tuiles — absent jusqu'ici, contrairement à l'Accueil qui a
// déjà "État du radar". Uniquement des agrégats dérivés de champs réels déjà utilisés par
// renderOpportunityTile (computeConfidence, change_24h_pct) : rien de nouveau n'est inventé,
// juste résumé avant le détail tuile par tuile.
function renderOpportunitiesSummary(containerId, opportunities) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const items = opportunities || [];
  if (items.length === 0) {
    el.innerHTML = "";
    return;
  }
  const confidences = items.map(computeConfidence);
  const avgConfidence = confidences.reduce((a, b) => a + b, 0) / items.length;
  const highConfidence = confidences.filter((c) => c >= 75).length;
  const up = items.filter((o) => o.change_24h_pct >= 0).length;
  const down = items.length - up;
  el.innerHTML = `
    <div class="stat-row">
      <div class="stat-card accent-gold"><div class="stat-label">Pépites trouvées</div><div class="stat-value">${items.length}</div></div>
      <div class="stat-card accent-teal"><div class="stat-label">Confiance moyenne</div><div class="stat-value">${avgConfidence.toFixed(0)} %</div></div>
      <div class="stat-card accent-violet"><div class="stat-label">Confiance ≥ 75 %</div><div class="stat-value">${highConfidence}</div></div>
      <div class="stat-card accent-gray"><div class="stat-label">Hausse / baisse 24h</div><div class="stat-value"><span class="positive">${up}</span> / <span class="negative">${down}</span></div></div>
    </div>`;
}

// limit optionnel (même convention que renderOpportunityCards juste au-dessus) : ajouté le
// 10/09/2026 pour que l'Accueil ("Meilleures analyses du moment", 3 éléments) puisse réutiliser
// cette même tuile compacte au lieu de la carte lourde .opp-card — plus cohérent avec l'onglet
// Opportunités, jamais un 2e composant pour la même information. Absent -> tout le tableau,
// comportement strictement inchangé pour l'appel existant (onglet Opportunités, sans limite).
function renderOpportunityTiles(containerId, opportunities, limit) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const sorted = (opportunities || []).slice().sort((a, b) => computeConfidence(b) - computeConfidence(a));
  const items = limit ? sorted.slice(0, limit) : sorted;
  if (items.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun screening réalisé pour l'instant — le Top 300 (memecoins exclus) sera analysé au premier cycle profond de la routine programmée.</p>`;
    return;
  }
  el.innerHTML = `<div class="opp-tile-grid">${items.map((o, i) => renderOpportunityTile(o, i, containerId)).join("")}</div>`;

  el.querySelectorAll(".opp-tile.clickable").forEach((tileEl) => {
    const opp = items.find((o) => (o.id || o.ticker) === tileEl.dataset.oppId);
    if (opp && window.applyHeatTint) applyHeatTint(tileEl, opp.change_24h_pct);
    const panelId = tileEl.dataset.detailTarget;
    const cgId = tileEl.dataset.cgid;
    const ath = tileEl.dataset.ath ? parseFloat(tileEl.dataset.ath) : null;
    const reason = tileEl.dataset.reason || "";
    attachDetailToggle(tileEl, panelId, { cgId, athChangePct: ath, reasoning: reason, tvSymbol: null, horizons: opp && opp.horizons });
  });
}
