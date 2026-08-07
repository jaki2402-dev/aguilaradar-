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

function gaugeSvg(value) {
  const r = 24;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - value / 100);
  const color = value >= 75 ? "var(--gain)" : value >= 55 ? "var(--accent)" : "var(--warning)";
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

function renderOpportunityCard(o, idx) {
  const conf = computeConfidence(o);
  const trendUp = o.sparkline && o.sparkline.length > 1 && o.sparkline[o.sparkline.length - 1] >= o.sparkline[0];
  const points = sparklinePoints(o.sparkline, 100, 32);
  const panelId = `detail-opp-${o.id || idx}`;
  return `
    <div class="opp-card clickable" data-detail-target="${panelId}" data-cgid="${o.cgId}" data-ath="${o.ath_change_pct ?? ""}" data-reason="${(o.reason || "").replace(/"/g, "&quot;")}">
      <div class="opp-card-top">
        <img src="${o.image}" alt="" class="opp-logo" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div class="opp-title">
          <div><span class="opp-name">${o.name}</span> <span class="opp-ticker-tag">${o.ticker}</span></div>
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
        ${(o.tags || []).map((t) => `<span class="tag">${t}</span>`).join("")}
        <span class="tag tag-confidence">Confiance ${conf}%</span>
      </div>
      <p class="hint" style="margin-top: 8px;">${o.reason}</p>
      <div class="opp-footer">
        <span>7j <strong class="${o.change_7d_pct >= 0 ? "positive" : "negative"}">${formatChangePct(o.change_7d_pct)}</strong></span>
        <span>30j <strong class="${o.change_30d_pct >= 0 ? "positive" : "negative"}">${formatChangePct(o.change_30d_pct)}</strong></span>
        <span>Cap. <strong>${formatMarketCap(o.market_cap)}</strong></span>
      </div>
      <div class="expand-hint">Voir l'analyse détaillée <span class="chevron">▾</span></div>
      <div class="detail-panel" id="${panelId}"></div>
    </div>`;
}

function renderOpportunityCards(containerId, opportunities, limit) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const items = (opportunities || []).slice().sort((a, b) => computeConfidence(b) - computeConfidence(a));
  const shown = limit ? items.slice(0, limit) : items;
  if (shown.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun screening réalisé pour l'instant — le Top 300 (memecoins exclus) sera analysé au premier cycle profond de la routine programmée.</p>`;
    return;
  }
  el.innerHTML = `<div class="opp-grid">${shown.map(renderOpportunityCard).join("")}</div>`;

  el.querySelectorAll(".opp-card.clickable").forEach((cardEl) => {
    const panelId = cardEl.dataset.detailTarget;
    const cgId = cardEl.dataset.cgid;
    const ath = cardEl.dataset.ath ? parseFloat(cardEl.dataset.ath) : null;
    const reason = cardEl.dataset.reason || "";
    attachDetailToggle(cardEl, panelId, { cgId, athChangePct: ath, reasoning: reason, tvSymbol: null });
  });
}
