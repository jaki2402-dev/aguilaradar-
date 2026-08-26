// Onglet Portefeuille — positions réelles de l'utilisateur (qty + capital investi saisis à la
// main dans data/portfolio.json, jamais déduits ni recalculés automatiquement). Valeur/P&L/P&L%
// ne sont JAMAIS stockés : toujours recalculés ici à partir du prix live (latestFavorisPrices,
// tenu à jour par prices.js), donc se réactualisent seuls à chaque tick de prix (refreshPrices,
// toutes les 60s) sans jamais nécessiter de mise à jour manuelle en dehors d'un changement réel
// de position (achat/vente signalé par l'utilisateur -> data/portfolio.json).

let latestPortfolio = null;
let latestPortfolioVerdicts = [];
let latestPortfolioThesis = null;

function latestVerdictFor(cgId, verdicts) {
  return (verdicts || [])
    .filter((v) => v.asset === cgId)
    .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))[0];
}

// Normalise "Renforcer"/"renforcer "/"Réduire"/etc. vers un slug ASCII pour la classe CSS
// (badge-reduire, jamais badge-réduire — aucune autre classe du site n'a de caractère accentué,
// et le texte affiché reste toujours recommendationRaw, jamais ce slug). La thèse est écrite par
// un modèle via une routine (voir data/portfolio-thesis.json), donc la casse/les accents ne sont
// pas garantis à 100%. Une valeur non reconnue reste affichée telle quelle (jamais masquée),
// juste sans badge coloré dédié — jamais un badge trompeur plutôt que pas de badge.
const THESIS_RECOMMENDATION_SLUGS = {
  renforcer: "renforcer",
  conserver: "conserver",
  attendre: "attendre",
  "réduire": "reduire",
  reduire: "reduire",
};
function normalizeRecommendation(value) {
  if (!value) return null;
  const norm = value.trim().toLowerCase();
  return THESIS_RECOMMENDATION_SLUGS[norm] || null;
}

// Calcul pur, sans DOM : réutilisé à la fois par le rendu de l'onglet (ci-dessous) et par
// l'Assistant (assistant.js, buildAiContext/answerPortfolio) pour ne jamais dupliquer la
// méthode de calcul à deux endroits. value/invested à null quand la position est "pending"
// (chiffres pas encore fournis) plutôt que d'inventer un chiffre — cohérent avec le "jamais
// halluciner" déjà appliqué partout ailleurs sur le site (verdicts "pending", etc.). thesis
// (data/portfolio-thesis.json, optionnel — peut ne pas encore exister) apporte la vraie analyse
// fondamentale hebdomadaire (recherche web réelle par la routine), distincte et complémentaire
// du verdict technique à 14 jours du moteur — jamais générée ici, jamais par l'IA du chat.
function computePortfolioSummary(portfolio, prices, verdicts, thesis) {
  const positions = (portfolio && portfolio.positions) || [];
  const thesisByAsset = (thesis && thesis.positions) || {};

  const rows = positions.map((pos) => {
    const fav = FAVORIS.find((f) => f.cgId === pos.cgId);
    const ticker = fav ? fav.ticker : pos.cgId;
    const name = fav ? fav.name : pos.cgId;
    const sectorColor = fav && typeof SECTOR_COLORS !== "undefined" ? SECTOR_COLORS[fav.cgId] : null;
    const latest = latestVerdictFor(pos.cgId, verdicts);
    const verdict = latest ? latest.verdict : null;
    const reasoning = latest ? latest.reasoning : null;

    const thesisEntry = thesisByAsset[pos.cgId] || null;
    const recommendation = thesisEntry ? normalizeRecommendation(thesisEntry.recommendation) : null;
    const recommendationRaw = thesisEntry ? thesisEntry.recommendation : null;
    const conviction = thesisEntry && typeof thesisEntry.conviction === "number" ? thesisEntry.conviction : null;
    const constat = thesisEntry ? thesisEntry.constat : null;

    const pending = !!pos.pending || pos.qty === null || pos.qty === undefined || pos.invested === null || pos.invested === undefined;
    if (pending) {
      return { cgId: pos.cgId, ticker, name, sectorColor, pending: true, qty: null, invested: null, value: null, pnl: null, pnlPct: null, costPerUnit: null, verdict, reasoning, recommendation, recommendationRaw, conviction, constat };
    }

    const priceInfo = prices && prices[pos.cgId];
    const price = priceInfo ? priceInfo.eur : null;
    const value = price !== null && price !== undefined ? pos.qty * price : null;
    const pnl = value !== null ? value - pos.invested : null;
    const pnlPct = value !== null && pos.invested ? (pnl / pos.invested) * 100 : null;
    const costPerUnit = pos.qty ? pos.invested / pos.qty : null;

    return { cgId: pos.cgId, ticker, name, sectorColor, pending: false, qty: pos.qty, invested: pos.invested, value, pnl, pnlPct, costPerUnit, verdict, reasoning, recommendation, recommendationRaw, conviction, constat };
  });

  let totalValue = 0;
  let totalInvested = 0;
  rows.forEach((r) => {
    if (r.value !== null) {
      totalValue += r.value;
      totalInvested += r.invested;
    }
  });
  const totalPnl = totalValue - totalInvested;
  const totalPnlPct = totalInvested ? (totalPnl / totalInvested) * 100 : null;
  const thesisGeneratedAt = (thesis && thesis.generated_at) || null;

  return { positions: rows, totalValue, totalInvested, totalPnl, totalPnlPct, thesisGeneratedAt };
}

// Tuile dense (même esprit que .favori-tile/.opp-tile — voir CLAUDE.md/style.css : "Coin360,
// l'essentiel, peu de défilement") plutôt qu'une ligne de tableau pleine largeur — l'ancien
// rendu en <table> était la seule vue du site à ne pas suivre cette grille, d'où le défilement
// remarqué par l'utilisateur sur 15 positions. Détail (investi/P&L€/coût moyen/raisonnement)
// replié dans .portfolio-tile-body, révélé par attachPortfolioToggle au clic — pas de fetch
// supplémentaire nécessaire ici, tout est déjà calculé par computePortfolioSummary.
function renderPortfolioTile(p, idx) {
  if (p.pending) {
    return `
      <div class="favori-tile portfolio-tile" style="--sector-color:${p.sectorColor || "var(--border)"}" title="${escapeHtml(p.name)}">
        <div class="favori-tile-head"><span class="favori-tile-tick">${escapeHtml(p.ticker)}</span></div>
        <div class="favori-tile-price hint" style="margin-top:7px;">En attente</div>
      </div>`;
  }

  const panelId = `portfolio-detail-${idx}`;
  const pnlClass = p.pnl === null ? "" : p.pnl >= 0 ? "positive" : "negative";
  const pnlSign = p.pnl === null ? "" : p.pnl >= 0 ? "+" : "-";
  const adviceHtml = p.verdict ? `<span class="badge badge-${p.verdict.toLowerCase()}">${escapeHtml(p.verdict)}</span>` : "";

  return `
    <div class="favori-tile portfolio-tile clickable" data-detail-target="${panelId}" data-cgid="${escapeHtml(p.cgId)}" style="--sector-color:${p.sectorColor || "var(--border)"}" title="${escapeHtml(p.name)}">
      <div class="favori-tile-head">
        <span class="favori-tile-tick">${escapeHtml(p.ticker)}</span>
        <span class="favori-tile-badge">${adviceHtml}</span>
      </div>
      <div class="favori-tile-price">${p.value !== null ? formatPrice(p.value, "EUR") : "—"}</div>
      <div class="favori-tile-change chip ${pnlClass}">${p.pnlPct !== null ? formatChangePct(p.pnlPct) : "—"}</div>
      <div class="expand-hint">Détail <span class="chevron">▾</span></div>
      <div class="portfolio-tile-body" id="${panelId}">
        <div class="detail-stats">
          <div class="detail-stat"><span class="hint">Investi</span><strong>${formatPrice(p.invested, "EUR")}</strong></div>
          <div class="detail-stat"><span class="hint">P&amp;L</span><strong class="${pnlClass}">${p.pnl !== null ? pnlSign + formatPrice(Math.abs(p.pnl), "EUR") : "—"}</strong></div>
          <div class="detail-stat"><span class="hint">Quantité</span><strong>${p.qty}</strong></div>
          <div class="detail-stat"><span class="hint">Coût moyen</span><strong>${p.costPerUnit !== null ? formatPrice(p.costPerUnit, "EUR") : "—"}</strong></div>
        </div>
        ${p.reasoning ? `<p class="hint" style="margin-top:10px;">${escapeHtml(p.reasoning)}</p>` : ""}
        ${renderThesisBlock(p)}
      </div>
    </div>`;
}

// Thèse hebdomadaire (data/portfolio-thesis.json, recherche web réelle par la routine
// hebdomadaire) — distincte du verdict technique du moteur juste au-dessus (horizon 14j) :
// une vraie analyse fondamentale complémentaire, jamais générée par le chat/l'IA elle-même (voir
// CLAUDE.md). Absente tant que la routine n'a pas encore tourné une première fois — pas de bloc
// affiché plutôt qu'un vide trompeur.
function renderThesisBlock(p) {
  if (!p.recommendation && !p.recommendationRaw && !p.constat) return "";
  const badgeHtml = p.recommendation
    ? `<span class="badge badge-${p.recommendation}">${escapeHtml(p.recommendationRaw || p.recommendation)}</span>`
    : p.recommendationRaw
      ? `<span class="badge badge-neutral">${escapeHtml(p.recommendationRaw)}</span>`
      : "";
  const convictionHtml = p.conviction !== null ? `<span class="hint" style="margin-left:6px;">Conviction ${p.conviction}/10</span>` : "";
  return `
        <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
          <span class="hint">Thèse hebdo (recherche réelle)</span>
          <div style="margin-top:4px;">${badgeHtml}${convictionHtml}</div>
          ${p.constat ? `<p class="hint" style="margin-top:6px;">${escapeHtml(p.constat)}</p>` : ""}
        </div>`;
}

// Toggle dédié (pas attachDetailToggle de detail.js) : ce dernier suppose un chargement
// asynchrone (graphique TradingView, indicateurs) inexistant ici — tout est déjà calculé en
// mémoire par computePortfolioSummary, un simple bascule de classe suffit.
function attachPortfolioToggle(tileEl) {
  tileEl.setAttribute("tabindex", "0");
  tileEl.setAttribute("role", "button");
  tileEl.setAttribute("aria-expanded", "false");
  function toggle() {
    const isOpen = tileEl.classList.toggle("expanded");
    tileEl.setAttribute("aria-expanded", String(isOpen));
  }
  tileEl.addEventListener("click", toggle);
  tileEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggle();
  });
}

// Même traitement "instrument" que le hero-card de l'Accueil (voir style.css) — cohérent avec
// le reste du site plutôt qu'un bloc de texte nu, seul l'onglet Portefeuille en était dépourvu.
// Perf. globale n'utilise PAS formatChangePct ici : sa flèche ▲/▼, sans lien de rendu établi
// avec .hero-stat-value (1.65rem, jamais utilisé ailleurs pour un pourcentage — Accueil n'y met
// que des compteurs entiers), s'est affichée en glyphe emoji coloré sur iOS à cette taille au
// lieu du triangle attendu (signalé par l'utilisateur, capture à l'appui). Le signe +/- déjà
// affiché à côté suffit à indiquer le sens, comme pour Latent juste au-dessus.
function renderPortfolioTotals(totalValue, totalInvested, thesisGeneratedAt) {
  const el = document.getElementById("portfolio-totals");
  if (!el) return;
  const totalPnl = totalValue - totalInvested;
  const totalPnlPct = totalInvested ? (totalPnl / totalInvested) * 100 : null;
  const pnlClass = totalPnl >= 0 ? "positive" : "negative";
  const pnlSign = totalPnl >= 0 ? "+" : "-";
  const pnlPctText = totalPnlPct !== null ? `${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)} %` : "—";
  const thesisNote = thesisGeneratedAt
    ? `<div class="hint" style="margin-top:8px;">Thèse hebdo (recherche réelle) mise à jour le ${new Date(thesisGeneratedAt).toLocaleDateString("fr-FR")}</div>`
    : "";
  el.innerHTML = `
    <div class="hero-card">
      <div class="hint">Vue d'ensemble</div>
      <div class="hero-stats">
        <div><div class="hero-stat-value">${formatPrice(totalValue, "EUR")}</div><div class="hero-stat-label">Valeur totale</div></div>
        <div><div class="hero-stat-value">${formatPrice(totalInvested, "EUR")}</div><div class="hero-stat-label">Investi</div></div>
        <div><div class="hero-stat-value ${pnlClass}">${pnlSign}${formatPrice(Math.abs(totalPnl), "EUR")}</div><div class="hero-stat-label">Latent</div></div>
        <div><div class="hero-stat-value ${pnlClass}">${pnlPctText}</div><div class="hero-stat-label">Perf. globale</div></div>
      </div>
    </div>${thesisNote}`;
}

// portfolio/verdicts/thesis omis (appel sans argument) -> réutilise le dernier jeu déjà connu :
// c'est ce que fait refreshPrices() à chaque tick (60s) pour ne recalculer que valeur/P&L depuis
// le nouveau prix, sans avoir à repasser par loadAllData() qui re-fetch tout le reste du site.
function renderPortfolio(portfolio, verdicts, thesis) {
  if (portfolio !== undefined) latestPortfolio = portfolio;
  if (verdicts !== undefined) latestPortfolioVerdicts = verdicts || [];
  if (thesis !== undefined) latestPortfolioThesis = thesis;

  const el = document.getElementById("portfolio-body");
  if (!el) return;

  const positions = (latestPortfolio && latestPortfolio.positions) || [];
  if (positions.length === 0) {
    el.innerHTML = `<p class="empty-state">Portefeuille pas encore configuré (data/portfolio.json vide).</p>`;
    return;
  }

  // Préserve les tuiles dépliées à travers le tick de prix (60s, refreshPrices) : sans ça, le
  // innerHTML complet ci-dessous perd .expanded à chaque rafraîchissement et une position qu'on
  // est en train de consulter se referme toute seule — donne l'impression que "ça ne bouge pas
  // vraiment en direct" plutôt qu'une vraie mise à jour fluide (signalé par l'utilisateur).
  const expandedIds = new Set(Array.from(el.querySelectorAll(".portfolio-tile.expanded")).map((t) => t.dataset.cgid));

  const prices = typeof latestFavorisPrices !== "undefined" ? latestFavorisPrices : {};
  const summary = computePortfolioSummary(latestPortfolio, prices, latestPortfolioVerdicts, latestPortfolioThesis);

  el.innerHTML = `<div class="favoris-grid portfolio-tile-grid">${summary.positions.map((p, i) => renderPortfolioTile(p, i)).join("")}</div>`;
  el.querySelectorAll(".portfolio-tile.clickable").forEach((tileEl) => {
    attachPortfolioToggle(tileEl);
    if (expandedIds.has(tileEl.dataset.cgid)) {
      tileEl.classList.add("expanded");
      tileEl.setAttribute("aria-expanded", "true");
    }
  });

  renderPortfolioTotals(summary.totalValue, summary.totalInvested, summary.thesisGeneratedAt);
}

// Calculette achat/vente — coût moyen pondéré (même méthode que "coût net moyen" affiché par
// l'app de suivi de l'utilisateur, voir CLAUDE.md). N'écrit JAMAIS data/portfolio.json : une
// vraie écriture publique demanderait sa propre protection dédiée (pas le portail cosmétique),
// donc ceci reste un calcul affiché à copier soi-même — décision explicite de l'utilisateur.
function computeTransactionResult(currentQty, currentInvested, type, price, qty) {
  const curQty = currentQty || 0;
  const curInvested = currentInvested || 0;
  if (!(price > 0) || !(qty > 0)) {
    return { error: "Indique un prix et une quantité strictement positifs." };
  }
  if (type === "achat") {
    return { newQty: curQty + qty, newInvested: curInvested + qty * price };
  }
  if (curQty <= 0) {
    return { error: "Aucune position actuelle pour cet actif — impossible de calculer une vente." };
  }
  if (qty > curQty) {
    return { error: `Tu ne peux pas vendre plus que ta position actuelle (${curQty}).` };
  }
  const costPerUnit = curInvested / curQty;
  return { newQty: curQty - qty, newInvested: curInvested - qty * costPerUnit };
}

function roundQty(n) {
  return Math.round(n * 1e8) / 1e8;
}
function roundEuro(n) {
  return Math.round(n * 100) / 100;
}

function renderTransactionCalculator() {
  const select = document.getElementById("tx-asset");
  const typeSelect = document.getElementById("tx-type");
  const priceInput = document.getElementById("tx-price");
  const qtyInput = document.getElementById("tx-qty");
  const btn = document.getElementById("tx-calc-btn");
  const resultEl = document.getElementById("tx-result");
  if (!select || !typeSelect || !priceInput || !qtyInput || !btn || !resultEl) return;

  select.innerHTML = FAVORIS.map((f) => `<option value="${f.cgId}">${escapeHtml(f.ticker)} — ${escapeHtml(f.name)}</option>`).join("");

  btn.addEventListener("click", () => {
    const cgId = select.value;
    const type = typeSelect.value;
    const price = parseFloat(priceInput.value);
    const qty = parseFloat(qtyInput.value);

    const positions = (latestPortfolio && latestPortfolio.positions) || [];
    const pos = positions.find((p) => p.cgId === cgId);
    const currentQty = pos && pos.qty !== null && pos.qty !== undefined ? pos.qty : 0;
    const currentInvested = pos && pos.invested !== null && pos.invested !== undefined ? pos.invested : 0;

    const result = computeTransactionResult(currentQty, currentInvested, type, price, qty);
    if (result.error) {
      resultEl.innerHTML = `<p class="hint" style="color:var(--loss)">${escapeHtml(result.error)}</p>`;
      return;
    }
    const fav = FAVORIS.find((f) => f.cgId === cgId);
    const ticker = fav ? fav.ticker : cgId;
    const newQty = roundQty(result.newQty);
    const newInvested = roundEuro(result.newInvested);
    resultEl.innerHTML = `
      <p class="hint">Actuel : ${currentQty} ${escapeHtml(ticker)} — ${formatPrice(currentInvested, "EUR")} investi</p>
      <p><strong>Nouveau : ${newQty} ${escapeHtml(ticker)} — ${formatPrice(newInvested, "EUR")} investi</strong></p>
      <p class="hint">À coller dans data/portfolio.json à la place de la ligne "${escapeHtml(cgId)}" :</p>
      <pre style="background:var(--bg-elevated); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text-dim); font-family:var(--font-mono); font-size:0.72rem; padding:10px 12px; white-space:pre-wrap; word-break:break-all;">{ "cgId": "${escapeHtml(cgId)}", "qty": ${newQty}, "invested": ${newInvested} }</pre>
    `;
  });
}
