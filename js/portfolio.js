// Onglet Portefeuille — positions réelles de l'utilisateur (qty + capital investi saisis à la
// main dans data/portfolio.json, jamais déduits ni recalculés automatiquement). Valeur/P&L/P&L%
// ne sont JAMAIS stockés : toujours recalculés ici à partir du prix live (latestFavorisPrices,
// tenu à jour par prices.js), donc se réactualisent seuls à chaque tick de prix (refreshPrices,
// toutes les 60s) sans jamais nécessiter de mise à jour manuelle en dehors d'un changement réel
// de position (achat/vente signalé par l'utilisateur -> data/portfolio.json).

let latestPortfolio = null;
let latestPortfolioVerdicts = [];
let latestPortfolioThesis = null;
let latestPortfolioHistory = null;

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

    const tvSymbol = fav ? fav.tvSymbol : null;

    const pending = !!pos.pending || pos.qty === null || pos.qty === undefined || pos.invested === null || pos.invested === undefined;
    if (pending) {
      return { cgId: pos.cgId, ticker, name, sectorColor, tvSymbol, pending: true, qty: null, invested: null, value: null, pnl: null, pnlPct: null, costPerUnit: null, verdict, reasoning, recommendation, recommendationRaw, conviction, constat };
    }

    const priceInfo = prices && prices[pos.cgId];
    const price = priceInfo ? priceInfo.eur : null;
    const value = price !== null && price !== undefined ? pos.qty * price : null;
    const pnl = value !== null ? value - pos.invested : null;
    const pnlPct = value !== null && pos.invested ? (pnl / pos.invested) * 100 : null;
    const costPerUnit = pos.qty ? pos.invested / pos.qty : null;

    return { cgId: pos.cgId, ticker, name, sectorColor, tvSymbol, pending: false, qty: pos.qty, invested: pos.invested, value, pnl, pnlPct, costPerUnit, verdict, reasoning, recommendation, recommendationRaw, conviction, constat };
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

// Répartition par position (barres horizontales, valeur actuelle) — vue d'ensemble avant le
// détail tuile par tuile plus bas. Réutilise le composant .sector-bars déjà utilisé par
// renderSectorBreakdown (Accueil, insights.js) plutôt qu'un 2e langage visuel pour la même
// idée. Purement dérivé de summary.positions, déjà calculé par computePortfolioSummary —
// aucun fetch, aucune donnée inventée.
function renderPortfolioAllocationChart(positions) {
  const withValue = (positions || []).filter((p) => !p.pending && p.value !== null && p.value > 0);
  if (withValue.length === 0) return "";
  const total = withValue.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return "";
  const sorted = withValue.slice().sort((a, b) => b.value - a.value);
  return `
    <div class="portfolio-chart-card">
      <span class="hint">Répartition par position (valeur actuelle)</span>
      <div class="sector-bars">
        ${sorted
          .map((p) => {
            const pct = (p.value / total) * 100;
            return `<div class="sector-row" style="--sector-color:${p.sectorColor || "var(--accent)"}">
              <span class="sector-label">${escapeHtml(p.ticker)}</span>
              <div class="sector-track"><div class="sector-fill" style="width:${pct.toFixed(1)}%"></div></div>
              <span class="sector-pct">${formatPrice(p.value, "EUR")} · ${pct.toFixed(0)}%</span>
            </div>`;
          })
          .join("")}
      </div>
    </div>`;
}

// Performance par position (P&L% latent, barres centrées sur la position la plus extrême) —
// répond directement au "mieux voir le suivi" : quelles positions tirent le portefeuille vers
// le haut ou le bas, en un coup d'œil, sans devoir déplier les 15 tuiles une à une.
function renderPortfolioPerformanceChart(positions) {
  const withPnl = (positions || []).filter((p) => !p.pending && p.pnlPct !== null && p.pnlPct !== undefined);
  if (withPnl.length === 0) return "";
  const sorted = withPnl.slice().sort((a, b) => b.pnlPct - a.pnlPct);
  const maxAbs = Math.max(...sorted.map((p) => Math.abs(p.pnlPct)), 1);
  return `
    <div class="portfolio-chart-card">
      <span class="hint">Performance par position (P&amp;L latent)</span>
      <div class="sector-bars">
        ${sorted
          .map((p) => {
            const widthPct = (Math.abs(p.pnlPct) / maxAbs) * 100;
            const color = p.pnlPct >= 0 ? "var(--gain)" : "var(--loss)";
            const sign = p.pnlPct >= 0 ? "+" : "";
            return `<div class="sector-row" style="--sector-color:${color}">
              <span class="sector-label">${escapeHtml(p.ticker)}</span>
              <div class="sector-track"><div class="sector-fill" style="width:${widthPct.toFixed(1)}%"></div></div>
              <span class="sector-pct">${sign}${p.pnlPct.toFixed(1)}%</span>
            </div>`;
          })
          .join("")}
      </div>
    </div>`;
}

// Évolution réelle de la valeur totale (data/portfolio-history.json, 1 point réel par jour
// écrit par aguilaradar-cycle-2h à partir de prix réellement récupérés ce cycle-là — jamais un
// point interpolé, deviné ou rétro-daté ici, cohérent avec le "jamais halluciner" appliqué
// partout ailleurs sur le site). Moins de 2 points : message d'attente plutôt qu'un graphique
// vide ou trompeur (même discipline que renderConfidenceHistory, insights.js). Réutilise
// sparklinePoints (cards.js, chargé avant portfolio.js) pour le tracé.
function renderPortfolioHistoryChart(history) {
  const snapshots = (history && history.snapshots) || [];
  if (snapshots.length < 2) {
    return `
      <div class="portfolio-chart-card">
        <span class="hint">Évolution de la valeur totale</span>
        <p class="empty-state">Historique en cours de constitution (1 point réel ajouté par jour) — repasse dans quelques jours pour voir la courbe se dessiner.</p>
      </div>`;
  }
  const sorted = snapshots.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const values = sorted.map((s) => s.total_value_eur);
  const w = 100;
  const h = 40;
  const linePoints = sparklinePoints(values, w, h);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const circles = sorted
    .map((s, i) => {
      const x = (i / (sorted.length - 1)) * w;
      const y = h - ((s.total_value_eur - min) / range) * h;
      const dateLabel = new Date(s.date).toLocaleDateString("fr-FR");
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" class="hist-point"><title>${escapeHtml(dateLabel)} : ${escapeHtml(formatPrice(s.total_value_eur, "EUR"))}</title></circle>`;
    })
    .join("");
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const evolution = first.total_value_eur ? ((last.total_value_eur - first.total_value_eur) / first.total_value_eur) * 100 : null;
  const evoClass = evolution === null ? "" : evolution >= 0 ? "positive" : "negative";
  const evoSign = evolution !== null && evolution >= 0 ? "+" : "";
  return `
    <div class="portfolio-chart-card">
      <span class="hint">Évolution de la valeur totale (${sorted.length} points réels)</span>
      <svg class="portfolio-history-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polyline points="${linePoints} ${w},${h} 0,${h}" class="hist-area" />
        <polyline points="${linePoints}" class="hist-line" />
        ${circles}
      </svg>
      <div class="portfolio-history-range">
        <span class="hint">${new Date(first.date).toLocaleDateString("fr-FR")} · ${formatPrice(first.total_value_eur, "EUR")}</span>
        ${evolution !== null ? `<span class="hint ${evoClass}">${evoSign}${evolution.toFixed(1)} %</span>` : ""}
        <span class="hint">${new Date(last.date).toLocaleDateString("fr-FR")} · ${formatPrice(last.total_value_eur, "EUR")}</span>
      </div>
    </div>`;
}

// Assemble les 3 graphiques ci-dessus dans #portfolio-charts (historique en pleine largeur,
// répartition + performance côte à côte en dessous — voir .portfolio-charts, style.css).
function renderPortfolioCharts(positions, history) {
  const historyHtml = renderPortfolioHistoryChart(history);
  const allocHtml = renderPortfolioAllocationChart(positions);
  const perfHtml = renderPortfolioPerformanceChart(positions);
  const gridParts = [allocHtml, perfHtml].filter(Boolean);
  return `${historyHtml}${gridParts.length ? `<div class="portfolio-charts">${gridParts.join("")}</div>` : ""}`;
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
    <div class="favori-tile portfolio-tile clickable" id="portfolio-tile-${idx}" data-detail-target="${panelId}" data-cgid="${escapeHtml(p.cgId)}" style="--sector-color:${p.sectorColor || "var(--border)"}" title="${escapeHtml(p.name)}">
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
        <div class="portfolio-technical-wrap">
          <span class="hint">Signaux techniques (calculés en direct)</span>
          <div class="portfolio-technical" id="portfolio-technical-${idx}"><p class="empty-state">Se charge à l'ouverture…</p></div>
        </div>
        ${p.reasoning ? `<p class="hint portfolio-reasoning">${highlightKeyInfo(p.reasoning)}</p>` : ""}
        ${renderThesisBlock(p)}
        ${typeof renderFavorisContextSection === "function" ? renderFavorisContextSection(p.ticker) : ""}
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
  const convictionHtml = p.conviction !== null ? `<span class="hint">Conviction ${p.conviction}/10</span>` : "";
  return `
        <div class="portfolio-thesis">
          <span class="hint">Thèse hebdo (recherche réelle)</span>
          <div class="portfolio-thesis-meta">${badgeHtml}${convictionHtml}</div>
          ${p.constat ? `<p class="hint portfolio-thesis-constat">${highlightKeyInfo(p.constat)}</p>` : ""}
        </div>`;
}

// Signaux techniques (RSI/MM20/MM50/vs ATH/corrélation BTC/profil de volume/divergence/carnet
// d'ordres) : même calcul déjà utilisé pour Favoris (renderTechnicalSection, detail.js — voir
// son en-tête, "rien n'est précalculé ni inventé"), jamais dupliqué ici. Chargé au premier
// dépli de CHAQUE tuile (comme attachDetailToggle), pas au rendu initial des 15 positions —
// sinon ouvrir l'onglet Portefeuille déclencherait d'un coup jusqu'à 45 requêtes réseau
// (marché + BTC + carnet, par position) pour un contenu que personne n'a encore demandé à voir.
// tvSymbol réel transmis (contrairement aux tuiles Favoris qui passent null) : le carnet
// d'ordres Binance est quasi gratuit une fois le fetch de marché déjà fait, et utile sur ses
// propres positions. showChart volontairement omis : pas de graphique TradingView dans une
// tuile dense, même choix que pour Favoris/Opportunités.
async function loadPortfolioTechnical(containerEl, p) {
  containerEl.innerHTML = `<p class="empty-state">Calcul des indicateurs en cours…</p>`;
  try {
    const asset = { cgId: p.cgId, ticker: p.ticker, athChangePct: null, tvSymbol: p.tvSymbol };
    const result = await renderTechnicalSection(asset);
    containerEl.innerHTML = result.html;
    return true;
  } catch (err) {
    console.error("Erreur indicateurs techniques (portefeuille):", err);
    containerEl.innerHTML = `<p class="empty-state">Indicateurs techniques indisponibles pour l'instant (limite API probable) — referme et rouvre la tuile pour réessayer.</p>`;
    return false;
  }
}

// Toggle du dépli, plus chargement paresseux des signaux techniques ci-dessus au premier dépli
// (mécanique identique à attachDetailToggle de detail.js : loaded remis à false en cas d'échec
// pour qu'une prochaine fermeture/réouverture retente réellement). Le reste du contenu du
// panneau (investi/P&L/coût moyen/raisonnement/thèse) reste du basculement pur de classe : déjà
// calculé en mémoire par computePortfolioSummary, aucun fetch requis pour cette partie-là.
function attachPortfolioToggle(tileEl, p, idx) {
  tileEl.setAttribute("tabindex", "0");
  tileEl.setAttribute("role", "button");
  tileEl.setAttribute("aria-expanded", "false");
  let loaded = false;
  function toggle() {
    const isOpen = tileEl.classList.toggle("expanded");
    tileEl.setAttribute("aria-expanded", String(isOpen));
    if (isOpen && !loaded) {
      loaded = true;
      const techEl = document.getElementById(`portfolio-technical-${idx}`);
      if (techEl) {
        loadPortfolioTechnical(techEl, p).then((success) => {
          if (!success) loaded = false;
        });
      }
    }
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
function renderPortfolio(portfolio, verdicts, thesis, history) {
  if (portfolio !== undefined) latestPortfolio = portfolio;
  if (verdicts !== undefined) latestPortfolioVerdicts = verdicts || [];
  if (thesis !== undefined) latestPortfolioThesis = thesis;
  if (history !== undefined) latestPortfolioHistory = history;

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
  summary.positions.forEach((p, i) => {
    if (p.pending) return;
    const tileEl = document.getElementById(`portfolio-tile-${i}`);
    if (!tileEl) return;
    attachPortfolioToggle(tileEl, p, i);
    if (expandedIds.has(tileEl.dataset.cgid)) {
      tileEl.classList.add("expanded");
      tileEl.setAttribute("aria-expanded", "true");
    }
  });

  renderPortfolioTotals(summary.totalValue, summary.totalInvested, summary.thesisGeneratedAt);

  const chartsEl = document.getElementById("portfolio-charts");
  if (chartsEl) chartsEl.innerHTML = renderPortfolioCharts(summary.positions, latestPortfolioHistory);
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
