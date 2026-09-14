// Activité on-chain — deux vitesses, comme le reste du site (voir CLAUDE.md "Les deux vitesses
// du site"). "En direct" (fetchBtcOnchainLive) = fetch navigateur à chaque ouverture de fiche,
// mêmes sources publiques gratuites que prices.js/detail.js, jamais de clé API, jamais une
// valeur inventée si l'appel échoue. "Historique" (renderMetricHistoryChart) = lit
// data/onchain-history.json, un snapshot réel par jour écrit par une routine (voir
// docs/routines/favoris-quotidien-onchain-history.md) — jamais un historique fabriqué ici.
//
// Bitcoin seulement pour l'instant : seul actif suivi avec des API publiques stables et
// gratuites sans clé pour ces métriques précises (DefiLlama pour la TVL de la chaîne,
// mempool.space pour les frais/mempool, Blockchain.com pour les tx/jour). Étendre à d'autres
// actifs demanderait une source fiable par écosystème (ex. un explorateur Ethereum pour ETH) —
// hors périmètre de cette première version, pas oublié.
//
// Avertissement honnête : les formes de réponse ci-dessous viennent de la documentation connue
// de ces API publiques, pas d'un test réseau réel depuis cet environnement (le proxy sortant de
// cette session bloque déjà api.coingecko.com et consorts, voir data/health-log.json) — chaque
// fonction vérifie donc la forme reçue avant de l'utiliser et retourne null plutôt que de
// planter ou d'afficher une valeur mal interprétée si la forme réelle diverge.

const ONCHAIN_FETCH_TIMEOUT_MS = 10000;

function onchainFetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ONCHAIN_FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// TVL de la chaîne Bitcoin (DefiLlama) : capitaux verrouillés dans l'écosystème BTC (sidechains,
// wrapped BTC, Lightning) — pas "Bitcoin a des smart contracts", nuance déjà documentée dans
// data/favoris-context.json pour le contexte long terme. DefiLlama publie un historique
// quotidien ; le dernier point sert de valeur "en direct".
async function fetchBtcTvlLive() {
  try {
    const res = await onchainFetchWithTimeout("https://api.llama.fi/v2/historicalChainTvl/bitcoin");
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const last = data[data.length - 1];
    if (!last || typeof last.tvl !== "number") return null;
    return { valueUsd: last.tvl, source: "DefiLlama" };
  } catch (e) {
    return null;
  }
}

async function fetchBtcFeesLive() {
  try {
    const res = await onchainFetchWithTimeout("https://mempool.space/api/v1/fees/recommended");
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.fastestFee !== "number") return null;
    return { satPerVb: data.fastestFee, source: "mempool.space" };
  } catch (e) {
    return null;
  }
}

async function fetchBtcMempoolLive() {
  try {
    const res = await onchainFetchWithTimeout("https://mempool.space/api/mempool");
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.count !== "number") return null;
    return { pendingCount: data.count, source: "mempool.space" };
  } catch (e) {
    return null;
  }
}

// n_tx (Blockchain.com /stats) : estimation glissante des transactions confirmées par jour —
// même famille de métrique que "Transactions par jour" de la vue historique, source différente
// assumée (c'est déjà le cas ailleurs sur le site, voir favoris-context.json vs
// portfolio-thesis.json : deux mesures voisines mais distinctes ne sont jamais fondues en une
// seule pour paraître plus cohérentes qu'elles ne le sont).
async function fetchBtcStatsLive() {
  try {
    const res = await onchainFetchWithTimeout("https://api.blockchain.info/stats?format=json");
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.n_tx !== "number") return null;
    return { txPerDay: data.n_tx, source: "Blockchain.com" };
  } catch (e) {
    return null;
  }
}

// Point d'entrée unique pour la fiche BTC : les 4 métriques en parallèle, chacune
// indépendamment null si sa propre source échoue — jamais un échec qui en cache un autre qui a
// réussi (même discipline que renderTechnicalSection, detail.js, pour le reste de la fiche).
async function fetchBtcOnchainLive() {
  const [tvl, fees, mempool, stats] = await Promise.all([
    fetchBtcTvlLive(),
    fetchBtcFeesLive(),
    fetchBtcMempoolLive(),
    fetchBtcStatsLive(),
  ]);
  return { tvl, fees, mempool, stats };
}

function renderOnchainLiveCards(live) {
  if (!live || (!live.tvl && !live.fees && !live.mempool && !live.stats)) {
    return `<p class="hint">Activité on-chain en direct indisponible pour l'instant (limite API probable) — referme et rouvre la fiche pour réessayer.</p>`;
  }
  const cards = [];
  if (live.tvl) cards.push({ label: "TVL du réseau", value: formatMarketCap(live.tvl.valueUsd), source: live.tvl.source });
  if (live.fees) cards.push({ label: "Frais rapides", value: `${live.fees.satPerVb} sat/vB`, source: live.fees.source });
  if (live.mempool) cards.push({ label: "Transactions en attente", value: live.mempool.pendingCount.toLocaleString("fr-FR"), source: live.mempool.source });
  if (live.stats) cards.push({ label: "Transactions / jour (est.)", value: live.stats.txPerDay.toLocaleString("fr-FR"), source: live.stats.source });
  return `<div class="stat-row">
    ${cards
      .map(
        (c) => `<div class="stat-card accent-teal">
          <div class="stat-label">${escapeHtml(c.label)}</div>
          <div class="stat-value">${c.value}</div>
          <div class="hint">${escapeHtml(c.source)}</div>
        </div>`
      )
      .join("")}
  </div>`;
}

// ---- Historique (data/onchain-history.json, snapshots réels écrits par une routine) ----

const ONCHAIN_HORIZONS = [
  { key: "1m", label: "1 mois", days: 30 },
  { key: "3m", label: "3 mois", days: 90 },
  { key: "6m", label: "6 mois", days: 180 },
  { key: "1y", label: "1 an", days: 365 },
];
const ONCHAIN_DEFAULT_HORIZON = "3m";

// Généralise renderPortfolioHistoryChart (portfolio.js) : même tracé SVG (sparklinePoints,
// cards.js, chargé avant ce fichier) et même discipline — moins de 2 points réels dans la
// fenêtre choisie = message d'attente honnête, jamais un graphique vide/trompeur ni des points
// interpolés. Onglets d'horizon (1 mois/3 mois/6 mois/1 an) comme la référence visuelle fournie
// par l'utilisateur. Fonction pure (aucun DOM en dehors du HTML retourné) — testable isolément.
function renderMetricHistoryChart(title, snapshots, valueKey, formatValue, activeHorizonKey) {
  const activeKey = activeHorizonKey || ONCHAIN_DEFAULT_HORIZON;
  const horizon = ONCHAIN_HORIZONS.find((h) => h.key === activeKey) || ONCHAIN_HORIZONS[1];
  const cutoff = Date.now() - horizon.days * 86400000;
  const inWindow = (snapshots || [])
    .filter((s) => s && typeof s[valueKey] === "number" && s.date && new Date(s.date).getTime() >= cutoff)
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const tabsHtml = `<div class="onchain-chart-tabs">${ONCHAIN_HORIZONS.map(
    (h) => `<button type="button" class="onchain-chart-tab${h.key === activeKey ? " active" : ""}" data-horizon="${h.key}">${h.label}</button>`
  ).join("")}</div>`;

  if (inWindow.length < 2) {
    return `<div class="onchain-chart-card" data-metric-key="${escapeHtml(valueKey)}">
      <span class="hint">${escapeHtml(title)}</span>
      <p class="empty-state">Historique insuffisant (${inWindow.length} point${inWindow.length > 1 ? "s" : ""}) — jamais fabriqué, un point réel s'ajoute chaque jour.</p>
      ${tabsHtml}
    </div>`;
  }
  const values = inWindow.map((s) => s[valueKey]);
  const last = inWindow[inWindow.length - 1];
  const first = inWindow[0];
  const changePct = first[valueKey] ? ((last[valueKey] - first[valueKey]) / first[valueKey]) * 100 : null;
  const changeClass = changePct === null ? "" : changePct >= 0 ? "positive" : "negative";
  const changeSign = changePct !== null && changePct >= 0 ? "+" : "";
  const w = 100;
  const h = 34;
  const linePoints = sparklinePoints(values, w, h);

  return `<div class="onchain-chart-card" data-metric-key="${escapeHtml(valueKey)}">
    <div class="log-header">
      <span class="hint">${escapeHtml(title)}</span>
      ${changePct !== null ? `<span class="hint ${changeClass}">${changeSign}${changePct.toFixed(1)} %</span>` : ""}
    </div>
    <strong>${formatValue(last[valueKey])} <span class="hint">dernier point</span></strong>
    <svg class="onchain-history-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="${linePoints} ${w},${h} 0,${h}" class="hist-area" />
      <polyline points="${linePoints}" class="hist-line" />
    </svg>
    ${tabsHtml}
  </div>`;
}

// Réécrit la carte en place au clic sur un onglet d'horizon — même esprit que wireClampToggles
// (app.js) : ré-attache après chaque ré-écriture puisque replaceWith détruit les anciens noeuds
// et leurs écouteurs.
function wireOnchainChartTabs(cardEl, title, snapshots, valueKey, formatValue) {
  cardEl.querySelectorAll(".onchain-chart-tab").forEach((btn) => {
    // stopPropagation obligatoire : cette carte vit à l'intérieur du .favori-tile cliquable
    // (attachDetailToggle, detail.js) qui replie toute la fiche au moindre clic non intercepté —
    // même piège déjà documenté pour "Lire plus" (renderClampableText, app.js).
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderMetricHistoryChart(title, snapshots, valueKey, formatValue, btn.dataset.horizon);
      const next = wrapper.firstElementChild;
      cardEl.replaceWith(next);
      wireOnchainChartTabs(next, title, snapshots, valueKey, formatValue);
    });
  });
}

// Section complète "Activité on-chain" pour la fiche BTC — direct (déjà résolu par
// fetchBtcOnchainLive) + historique (snapshots déjà chargés depuis data/onchain-history.json,
// voir latestOnchainHistory dans app.js). Retourne "" pour tout autre actif : cohérent avec le
// reste de cette section de code, jamais une carte vide ou "non disponible" pour un actif où la
// question ne se pose même pas.
function renderOnchainSection(cgId, live, onchainHistory) {
  if (cgId !== "bitcoin") return "";
  const snapshots = (onchainHistory && onchainHistory.assets && onchainHistory.assets.bitcoin && onchainHistory.assets.bitcoin.snapshots) || [];
  return `<div class="detail-onchain">
    <strong>Activité on-chain</strong>
    ${renderOnchainLiveCards(live)}
    <div class="onchain-history-grid">
      ${renderMetricHistoryChart("TVL du réseau", snapshots, "tvl_usd", (v) => formatMarketCap(v))}
      ${renderMetricHistoryChart("Transactions par jour", snapshots, "tx_per_day", (v) => v.toLocaleString("fr-FR"))}
      ${renderMetricHistoryChart("Adresses actives par jour", snapshots, "active_addresses", (v) => v.toLocaleString("fr-FR"))}
    </div>
  </div>`;
}

function wireOnchainSection(sectionEl, onchainHistory) {
  if (!sectionEl) return;
  const snapshots = (onchainHistory && onchainHistory.assets && onchainHistory.assets.bitcoin && onchainHistory.assets.bitcoin.snapshots) || [];
  const charts = [
    { key: "tvl_usd", title: "TVL du réseau", format: (v) => formatMarketCap(v) },
    { key: "tx_per_day", title: "Transactions par jour", format: (v) => v.toLocaleString("fr-FR") },
    { key: "active_addresses", title: "Adresses actives par jour", format: (v) => v.toLocaleString("fr-FR") },
  ];
  sectionEl.querySelectorAll(".onchain-chart-card").forEach((cardEl, i) => {
    const c = charts[i];
    if (c) wireOnchainChartTabs(cardEl, c.title, snapshots, c.key, c.format);
  });
}
