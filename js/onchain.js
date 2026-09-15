// Activité on-chain — deux vitesses, comme le reste du site (voir CLAUDE.md "Les deux vitesses
// du site"). "En direct" (fetchBtcOnchainLive) = fetch navigateur à chaque ouverture de fiche,
// mêmes sources publiques gratuites que prices.js/detail.js, jamais de clé API, jamais une
// valeur inventée si l'appel échoue. "Historique" (renderMetricHistoryChart) = lit
// data/onchain-history.json, un snapshot réel par jour écrit par une routine (voir
// docs/routines/favoris-quotidien.md §2) — jamais un historique fabriqué ici.
//
// Bitcoin seul a le niveau "direct" (navigateur) : seul actif avec des API publiques stables et
// gratuites sans clé confirmées pour ces métriques précises (DefiLlama, mempool.space,
// Blockchain.com). Étendu le 15/09/2026 à 7 actifs de plus (ETH, ARB, TIA, INJ, PEAQ, AIOZ, FLUX
// — voir ONCHAIN_OWN_CHAIN_ASSETS ci-dessous) au niveau "historique" SEULEMENT : Blockscout, la
// source la plus solide pour les chaînes EVM, exige maintenant une clé "PRO" pour un usage
// programmatique — pas le genre d'API "stable et gratuite sans clé" que ce fichier exige pour un
// fetch navigateur, donc écrit côté routine (qui a son propre accès Blockscout) plutôt que fetché
// ici. Les 6 jetons sans chaîne propre (GRT, CTSI, LINK, ONDO, LPT, FET pas encore classé) n'ont
// ni direct ni historique — voir ONCHAIN_NO_OWN_CHAIN_ASSETS, une explication plutôt qu'un chiffre
// qui mesurerait Ethereum/Solana en général.
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

// Actifs avec une vraie chaîne à eux (la question "TVL du réseau / tx par jour / adresses
// actives" a un sens) — vérifié projet par projet le 15/09/2026, pas une hypothèse générale sur
// "a un jeton natif" :
// - bitcoin : direct (fetchBtcOnchainLive) + historique, en place depuis le 14/09.
// - ethereum, arbitrum : EVM, couverts par Blockscout — tx/jour confirmé réellement (appel direct
//   /api/v2/stats/charts/transactions, chain_id 1, données réelles reçues) le 15/09/2026 ; arbitrum
//   utilise le même produit Blockscout (chain_id 42161, non revérifié séparément) donc supposé pareil.
//   Historique seulement pour l'instant (pas de niveau "direct" navigateur : Blockscout exige
//   désormais une clé "PRO" pour son usage programmatique — voir docs/routines/favoris-quotidien.md
//   §2 — donc écrit par la routine, pas fetché depuis le navigateur comme pour BTC).
// - celestia, injective-protocol, peaq-2, aioz-network, zelcash : chaîne propre confirmée, mais
//   aucune source précise vérifiée depuis cette session (proxy sortant bloqué sur ces domaines,
//   voir docs/routines/favoris-quotidien.md §2) — recherche laissée à la routine (WebSearch réel).
//   Historique vide ("Historique insuffisant") tant qu'aucun snapshot réel n'existe, jamais fabriqué.
const ONCHAIN_OWN_CHAIN_ASSETS = ["bitcoin", "ethereum", "arbitrum", "celestia", "injective-protocol", "peaq-2", "aioz-network", "zelcash"];

// Jetons SANS chaîne propre (circulent sur Ethereum ou Solana) : "l'activité on-chain" mesurerait
// ce réseau hôte en général, pas ce projet précisément — un chiffre honnête mais trompeur si
// présenté comme spécifique à ce jeton. Une explication est affichée à la place d'un graphique.
// fetch-ai (FET) volontairement absent des deux listes : avait sa propre chaîne (fetchhub) mais
// son statut a évolué depuis la fusion ASI Alliance — à reconfirmer par une vraie recherche avant
// de classer, pas deviné ici (donc aucune section affichée pour FET pour l'instant).
const ONCHAIN_NO_OWN_CHAIN_ASSETS = ["the-graph", "cartesi", "chainlink", "ondo-finance", "livepeer", "jupiter-exchange-solana"];

// Section complète "Activité on-chain" — direct (fetchBtcOnchainLive, BTC uniquement) + historique
// (snapshots déjà chargés depuis data/onchain-history.json, voir latestOnchainHistory dans
// app.js) pour tout actif de ONCHAIN_OWN_CHAIN_ASSETS ; une explication pour un jeton sans chaîne
// propre ; "" pour tout le reste (un actif hors des 15 favoris, ex. une opportunité, où cette
// catégorisation n'a jamais été vérifiée) — jamais une carte vide ou une supposition non vérifiée.
function renderOnchainSection(cgId, live, onchainHistory) {
  if (ONCHAIN_NO_OWN_CHAIN_ASSETS.includes(cgId)) {
    return `<div class="detail-onchain">
      <strong>Activité on-chain</strong>
      <p class="hint">Ce jeton n'a pas de chaîne propre (il circule sur Ethereum ou Solana) : mesurer "l'activité on-chain" reviendrait à mesurer l'activité de ce réseau en général, pas celle de ce projet précisément — pas affiché ici pour cette raison, plutôt qu'un chiffre trompeur.</p>
    </div>`;
  }
  if (!ONCHAIN_OWN_CHAIN_ASSETS.includes(cgId)) return "";
  const snapshots = (onchainHistory && onchainHistory.assets && onchainHistory.assets[cgId] && onchainHistory.assets[cgId].snapshots) || [];
  return `<div class="detail-onchain">
    <strong>Activité on-chain</strong>
    ${cgId === "bitcoin" ? renderOnchainLiveCards(live) : ""}
    <div class="onchain-history-grid">
      ${renderMetricHistoryChart("TVL du réseau", snapshots, "tvl_usd", (v) => formatMarketCap(v))}
      ${renderMetricHistoryChart("Transactions par jour", snapshots, "tx_per_day", (v) => v.toLocaleString("fr-FR"))}
      ${renderMetricHistoryChart("Adresses actives par jour", snapshots, "active_addresses", (v) => v.toLocaleString("fr-FR"))}
    </div>
  </div>`;
}

function wireOnchainSection(sectionEl, cgId, onchainHistory) {
  if (!sectionEl) return;
  const snapshots = (onchainHistory && onchainHistory.assets && onchainHistory.assets[cgId] && onchainHistory.assets[cgId].snapshots) || [];
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
