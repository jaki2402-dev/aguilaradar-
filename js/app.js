// Orchestration : navigation par onglets, chargement des données JSON, rendu.

const TABS = ["overview", "portfolio", "favoris", "opportunities", "journal", "engine", "notifications", "assistant"];
let pricesIntervalStarted = false;
let latestFavorisContext = null;

function switchTab(tabId) {
  TABS.forEach((id) => {
    document.getElementById(`tab-${id}`).classList.toggle("active", id === tabId);
    document.querySelector(`[data-tab="${id}"]`).classList.toggle("active", id === tabId);
  });
  if (window.notifyTabActive) notifyTabActive(tabId);
  if (tabId === "notifications" && window.clearNotifBellBadge) clearNotifBellBadge();
}

async function loadJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Chargement impossible :", url, err);
    return null;
  }
}

// Rend un div.clickable navigable et activable au clavier (Entrée/Espace), sans changer son
// comportement au clic — pour les actions "voir plus" qui n'ont pas de vrai <button>.
function makeKeyboardClickable(el) {
  if (!el) return;
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    el.click();
  });
}

// Grille dense (esprit Coin360 : l'essentiel, peu de défilement) — nom/secteur complets
// disponibles au survol (title) et dans la fiche détaillée au clic, pas sur la tuile elle-même
// pour rester épuré. Classe .favori-tile volontairement DISTINCTE de .favori-card (toujours
// utilisée telle quelle par search.js pour un résultat de recherche isolé, hors grille) — pas
// de dépendance partagée entre les deux, un changement ici ne peut pas casser l'autre.
function renderFavorisGrid() {
  const grid = document.getElementById("favoris-grid");
  grid.innerHTML = FAVORIS.map(
    (f) => `
    <div class="favori-tile clickable" data-detail-target="detail-fav-${f.ticker}" style="--sector-color:${SECTOR_COLORS[f.cgId] || "var(--border)"}" title="${escapeHtml(f.name)} — ${escapeHtml(SECTORS[f.cgId] || "")}">
      <div class="favori-tile-head">
        <span class="favori-tile-tick">${f.ticker}</span>
        <span class="favori-tile-badge" id="verdict-${f.ticker}"></span>
      </div>
      <div class="favori-tile-price skeleton" id="price-${f.ticker}">0 000 €</div>
      <div class="favori-tile-change chip skeleton" id="change-${f.ticker}">▲ 0,00 %</div>
      <div class="expand-hint">Détail <span class="chevron">▾</span></div>
      <div class="detail-panel" id="detail-fav-${f.ticker}"></div>
    </div>`
  ).join("");

  // Graphique TradingView chargé au tap (dans le panneau de détail), plus au chargement de
  // la page : 15 widgets simultanés étaient la principale cause du défilement lourd de cet
  // onglet — voir renderDetailPanel (detail.js) pour le montage effectif.
  document.querySelectorAll("#favoris-grid .favori-tile.clickable").forEach((cardEl, i) => {
    const f = FAVORIS[i];
    attachDetailToggle(cardEl, `detail-fav-${f.ticker}`, {
      cgId: f.cgId,
      tvSymbol: f.tvSymbol,
      ticker: f.ticker,
      athChangePct: null,
      reasoning: null,
      showChart: true,
    });
  });
}

function updateFavorisVerdicts(verdicts) {
  FAVORIS.forEach((f) => {
    const chipEl = document.getElementById(`verdict-${f.ticker}`);
    if (!chipEl) return;
    const latest = (verdicts || [])
      .filter((v) => v.asset === f.cgId)
      .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))[0];
    if (!latest) return;
    chipEl.innerHTML = `<span class="badge badge-${latest.verdict.toLowerCase()}">${latest.verdict}</span>`;
    const cardEl = chipEl.closest(".favori-tile");
    if (cardEl) {
      cardEl.dataset.reasoning = latest.reasoning;
      cardEl.dataset.verdict = latest.verdict;
    }
  });
}

const HEAT_TIER_CLASSES = ["heat-pos-1", "heat-pos-2", "heat-pos-3", "heat-neg-1", "heat-neg-2", "heat-neg-3"];

// Fond légèrement teinté vert/rouge selon l'intensité de la variation 24h (esprit Coin360 :
// la couleur porte l'essentiel de l'information avant même de lire le chiffre). Paliers basés
// sur THRESHOLDS.directionalMovePct (config.js) — le même seuil "mouvement significatif" que
// le reste du site, pas un nombre réinventé ici.
function applyHeatTint(tileEl, changePct) {
  if (!tileEl) return;
  tileEl.classList.remove(...HEAT_TIER_CLASSES);
  const half = THRESHOLDS.directionalMovePct / 2;
  const mag = Math.abs(changePct);
  const tier = mag >= THRESHOLDS.directionalMovePct ? 3 : mag >= half ? 2 : 1;
  tileEl.classList.add(changePct >= 0 ? `heat-pos-${tier}` : `heat-neg-${tier}`);
}

// Flash bref vert/rouge sur le prix qui vient de bouger — reflow forcé (offsetWidth) pour que
// l'animation puisse rejouer sur des tics consécutifs, pas seulement le premier (sans ça,
// réappliquer la même classe sans reflow ne relance pas une animation CSS déjà terminée).
function flashPriceUpdate(el, direction) {
  if (!el) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.classList.remove("price-flash-up", "price-flash-down");
  void el.offsetWidth;
  el.classList.add(direction === "up" ? "price-flash-up" : "price-flash-down");
}

async function refreshPrices() {
  try {
    const prices = await fetchFavorisPrices();
    const previousPrices = latestFavorisPrices;
    latestFavorisPrices = prices;
    FAVORIS.forEach((f) => {
      const p = prices[f.cgId];
      const priceEl = document.getElementById(`price-${f.ticker}`);
      const changeEl = document.getElementById(`change-${f.ticker}`);
      if (!p || !priceEl || !changeEl) return;
      const previous = previousPrices[f.cgId];
      priceEl.textContent = formatPrice(p.eur, "EUR");
      priceEl.classList.remove("skeleton");
      const change = p.eur_24h_change;
      changeEl.textContent = formatChangePct(change);
      changeEl.className = "chip skeleton-off " + (change >= 0 ? "positive" : "negative");
      changeEl.classList.remove("skeleton");
      applyHeatTint(changeEl.closest(".favori-tile"), change);
      // Jamais au tout premier affichage (previous absent) : le passage hors-skeleton suffit
      // déjà comme repère visuel, un flash n'aurait rien de "ça vient de changer" à montrer.
      if (previous && previous.eur !== undefined && previous.eur !== p.eur) {
        flashPriceUpdate(priceEl, p.eur > previous.eur ? "up" : "down");
      }
    });
    // Recalcule valeur/P&L de l'onglet Portefeuille sur ce même tick de prix (60s) — sans
    // argument : réutilise les positions/verdicts déjà chargés par le dernier loadAllData(),
    // voir portfolio.js.
    if (window.renderPortfolio) renderPortfolio();
    document.getElementById("last-price-update").textContent =
      "Prix à l'instant : " + new Date().toLocaleTimeString("fr-FR");
  } catch (err) {
    console.error("Erreur de rafraîchissement des prix :", err);
    document.getElementById("last-price-update").textContent =
      "Prix indisponibles pour l'instant (nouvel essai automatique sous peu).";
  }
}

let latestOpportunityTickers = [];

function renderOpportunities(data) {
  const items = (data && data.opportunities) || [];
  latestOpportunityTickers = items.map((o) => o.ticker).filter(Boolean);
  renderOpportunityTiles("opportunities-body", items);
  renderOpportunityCards("accueil-highlights", items, 3);
  if (constellationControllers.opportunities) constellationControllers.opportunities.refresh();
}

// Aperçu tronqué (3 lignes) + "Lire plus" pour un texte long — Journal (raisonnement) et
// Alertes (message) partagent ce motif : sans lui, un texte de 500+ caractères (fréquent côté
// alertes) rendait ces deux onglets illisibles au scroll. Sous le seuil, retourne un <p> nu —
// forme strictement identique à l'ancien rendu, donc aucun texte court n'est jamais affecté.
const CLAMP_TEXT_THRESHOLD = 200;
let clampTextUid = 0;

function renderClampableText(text) {
  const safe = highlightKeyInfo(text || "");
  if (!text || text.length <= CLAMP_TEXT_THRESHOLD) return `<p>${safe}</p>`;
  const id = `clamp-text-${++clampTextUid}`;
  return `<p class="clamp-text" id="${id}">${safe}</p><span class="expand-hint expand-hint-inline clickable" data-clamp-target="${id}">Lire plus <span class="chevron">▾</span></span>`;
}

// stopPropagation : le "Lire plus" vit à l'intérieur d'une .journal-entry.clickable qui a son
// propre clic (attachDetailToggle, voir detail.js) — sans ça, déplier le texte ouvrirait aussi
// la grosse fiche d'analyse en dessous, deux actions pour un seul clic.
function wireClampToggles(root) {
  root.querySelectorAll("[data-clamp-target]").forEach((btn) => {
    makeKeyboardClickable(btn);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = document.getElementById(btn.dataset.clampTarget);
      if (!p) return;
      const isOpen = p.classList.toggle("clamp-open");
      btn.classList.toggle("expanded", isOpen);
    });
  });
}

const JOURNAL_PAGE_SIZE = 15;
let journalSorted = [];
let journalShown = JOURNAL_PAGE_SIZE;

function renderJournal(verdicts) {
  const el = document.getElementById("journal-body");
  if (verdicts.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun verdict émis pour l'instant. Dès que la routine programmée sera active, chaque verdict apparaîtra ici et y restera de façon permanente.</p>`;
    return;
  }
  // Historique permanent : meme logique de pagination que les Alertes, avant que ca devienne
  // un probleme (croissance plus lente ici, mais le meme motif finirait par se reproduire).
  journalSorted = verdicts.slice().reverse();
  journalShown = JOURNAL_PAGE_SIZE;
  renderJournalPage();
}

function renderJournalPage() {
  const el = document.getElementById("journal-body");
  const visible = journalSorted.slice(0, journalShown);
  const remaining = journalSorted.length - visible.length;
  el.innerHTML =
    visible
      .map(
        (v, i) => `
      <div class="journal-entry clickable verdict-${(v.verdict || "").toLowerCase()}" data-detail-target="detail-journal-${v.id || i}" data-cgid="${v.asset}">
        <div class="log-header">
          <span><strong>${v.ticker || v.asset}</strong> · ${v.issued_at}</span>
          <span class="badge badge-${(v.verdict || "").toLowerCase()}">${v.verdict}</span>
        </div>
        ${renderClampableText(v.reasoning)}
        <p class="hint">Confiance ${v.confidence_pct ?? "—"} % · horizon ${v.horizon_days} j · statut ${v.status}</p>
        ${v.status === "pending" ? renderProvisionalBadge(v) : ""}
        <div class="expand-hint">Voir l'analyse détaillée <span class="chevron">▾</span></div>
        <div class="detail-panel" id="detail-journal-${v.id || i}"></div>
      </div>`
      )
      .join("") +
    (remaining > 0
      ? `<div class="expand-hint clickable" id="journal-load-more">Voir ${Math.min(remaining, JOURNAL_PAGE_SIZE)} verdict(s) de plus (${remaining} restant${remaining > 1 ? "s" : ""}) <span class="chevron">▾</span></div>`
      : "");

  wireClampToggles(el);
  const byPanelId = {};
  visible.forEach((v, i) => (byPanelId[`detail-journal-${v.id || i}`] = v));
  el.querySelectorAll(".journal-entry.clickable").forEach((entryEl) => {
    const panelId = entryEl.dataset.detailTarget;
    const cgId = entryEl.dataset.cgid;
    const v = byPanelId[panelId];
    const fav = FAVORIS.find((f) => f.cgId === cgId);
    attachDetailToggle(entryEl, panelId, {
      cgId,
      tvSymbol: fav ? fav.tvSymbol : null,
      athChangePct: null,
      reasoning: v ? v.reasoning : null,
      verdict: v ? v.verdict : null,
    });
  });

  const loadMoreBtn = document.getElementById("journal-load-more");
  if (loadMoreBtn) {
    makeKeyboardClickable(loadMoreBtn);
    loadMoreBtn.addEventListener("click", () => {
      journalShown += JOURNAL_PAGE_SIZE;
      renderJournalPage();
    });
  }
}

const ALERT_TYPE_LABELS = {
  seuil_technique: "Seuil technique",
  actualite_macro: "Actu macro",
  actualite_favori: "Actu favori",
  actualite_generale: "Actu crypto",
  avis_du_jour: "Avis du jour",
  opportunite: "Opportunité",
  signal_precoce: "Signal précoce",
  regime_change_impact: "Changement de régime",
};

// Sentiment (positif/négatif/neutre) : déjà calculé par la routine sur une partie des alertes
// (voir data/alerts.json) mais jamais affiché jusqu'ici — chaque alerte montrait le même badge
// ambre générique quel que soit son sens. Badge dédié, coloré comme un verdict (vert/rouge),
// pour qu'une actualité franchement bullish ou bearish saute aux yeux au lieu de se fondre
// parmi les alertes purement factuelles. Normalise la casse/les accents (comme
// normalizeRecommendation dans portfolio.js) : la valeur vient d'un modèle via une routine,
// jamais garantie caractère pour caractère.
const SENTIMENT_BADGES = {
  positif: { cls: "badge-achat", text: "▲ Bullish" },
  negatif: { cls: "badge-vente", text: "▼ Bearish" },
  neutre: { cls: "badge-neutral", text: "Neutre" },
};
function sentimentBadgeHtml(sentiment) {
  if (!sentiment) return "";
  const key = sentiment.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const b = SENTIMENT_BADGES[key];
  return b ? `<span class="badge ${b.cls}">${b.text}</span>` : "";
}

// Avis du jour : la synthèse la plus récente (type "avis_du_jour", data/alerts.json, écrite au
// plus une fois par jour par la routine — voir son prompt) mise en avant tout en haut de
// l'Accueil, plutôt que noyée dans la liste complète de l'onglet Alertes. Même contenu que la
// notification push reçue au même moment (le Worker Cloudflare pousse déjà toute nouvelle
// entrée d'alerts.json sans filtrer par type, voir cloudflare-worker/worker.js) : ce bloc est
// simplement la version "je suis déjà dans l'app" de la même information.
function renderAvisDuJour(alerts) {
  const el = document.getElementById("avis-du-jour");
  if (!el) return;
  const avisEntries = (alerts || []).filter((a) => a.type === "avis_du_jour");
  if (avisEntries.length === 0) {
    el.innerHTML = "";
    return;
  }
  const latest = avisEntries.slice().sort((a, b) => new Date(b.triggered_at) - new Date(a.triggered_at))[0];
  const ageMs = Date.now() - new Date(latest.triggered_at).getTime();
  // >30h plutôt que >24h : marge pour un cycle qui écrit un peu tard dans la journée sans
  // déclencher un avertissement "pas d'aujourd'hui" trompeur pour un avis en réalité tout frais.
  const staleHint = ageMs > 30 * 3600 * 1000 ? ` — dernière mise à jour il y a plus d'un jour, pas forcément celui d'aujourd'hui` : "";
  el.innerHTML = `
    <div class="hero-card avis-du-jour-card">
      <div class="avis-du-jour-head"><span class="hint">Avis du jour</span>${sentimentBadgeHtml(latest.sentiment)}</div>
      <p class="avis-du-jour-text">${escapeHtml(latest.message)}</p>
      <div class="hint">${new Date(latest.triggered_at).toLocaleString("fr-FR")}${staleHint}</div>
    </div>`;
}

const NOTIFICATIONS_PAGE_SIZE = 15;
let notificationsSorted = [];
let notificationsShown = NOTIFICATIONS_PAGE_SIZE;

function renderNotifications(alerts) {
  const el = document.getElementById("notifications-body");
  if (!alerts || alerts.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucune alerte active. La routine (toutes les 2h) déclenchera une notification ici pour un seuil technique franchi, une actualité macro ou sur un favori jugée significative, ou une opportunité forte — avec le signal et le pourquoi.</p>`;
    return;
  }
  // Historique permanent (jamais purge) : peut grossir indefiniment, d'ou la pagination
  // plutot qu'un rendu integral qui rendrait l'onglet ingerable au scroll a terme.
  notificationsSorted = alerts.slice().reverse();
  notificationsShown = NOTIFICATIONS_PAGE_SIZE;
  renderNotificationsPage();
}

function renderNotificationsPage() {
  const el = document.getElementById("notifications-body");
  const visible = notificationsSorted.slice(0, notificationsShown);
  const remaining = notificationsSorted.length - visible.length;
  el.innerHTML =
    visible
      .map(
        (a) => `
      <div class="alert-entry type-${a.type || ""}">
        <div class="log-header">
          <span><strong>${a.ticker_ou_theme || a.ticker || ""}</strong> · ${a.triggered_at}</span>
          <span class="alert-badges">${sentimentBadgeHtml(a.sentiment)}<span class="badge badge-warning">${ALERT_TYPE_LABELS[a.type] || a.type}</span></span>
        </div>
        ${renderClampableText(a.message)}
        ${a.source ? `<p class="hint">Source : ${escapeHtml(a.source)}</p>` : ""}
      </div>`
      )
      .join("") +
    (remaining > 0
      ? `<div class="expand-hint clickable" id="notifications-load-more">Voir ${Math.min(remaining, NOTIFICATIONS_PAGE_SIZE)} alerte(s) de plus (${remaining} restante${remaining > 1 ? "s" : ""}) <span class="chevron">▾</span></div>`
      : `<p class="hint" style="text-align:center; margin-top:12px;">${notificationsSorted.length} alerte(s) au total, historique permanent.</p>`);

  wireClampToggles(el);
  const loadMoreBtn = document.getElementById("notifications-load-more");
  if (loadMoreBtn) {
    makeKeyboardClickable(loadMoreBtn);
    loadMoreBtn.addEventListener("click", () => {
      notificationsShown += NOTIFICATIONS_PAGE_SIZE;
      renderNotificationsPage();
    });
  }
}

const REGIME_LABELS = { "risk-on": "Appétit pour le risque", "neutre": "Neutre", "risk-off": "Aversion au risque" };

function renderMacroRegime(engineHistory) {
  const el = document.getElementById("macro-regime-banner");
  if (!el) return;
  const regime = engineHistory && engineHistory.macro_regime;
  if (!regime || !regime.regime) {
    el.innerHTML = `<p class="empty-state">Régime de marché pas encore classifié — calculé au premier cycle profond (Fear &amp; Greed + dominance BTC).</p>`;
    return;
  }
  const cls = regime.regime === "risk-on" ? "positive" : regime.regime === "risk-off" ? "negative" : "";
  el.innerHTML = `
    <div class="hero-card">
      <div class="hint">Régime de marché actuel${glossaryTipHtml("Régime de marché")}</div>
      <div class="hero-stats">
        <div><div class="hero-stat-value ${cls}">${REGIME_LABELS[regime.regime] || regime.regime}</div><div class="hero-stat-label">Contexte macro</div></div>
        <div><div class="hero-stat-value">${regime.fear_greed_value ?? "—"}</div><div class="hero-stat-label">Fear &amp; Greed${glossaryTipHtml("Indice de peur et de cupidité")}</div></div>
        <div><div class="hero-stat-value">${regime.btc_dominance_pct !== null && regime.btc_dominance_pct !== undefined ? regime.btc_dominance_pct.toFixed(1) + " %" : "—"}</div><div class="hero-stat-label">Dominance BTC${glossaryTipHtml("Dominance BTC")}</div></div>
      </div>
      ${regime.note ? `<p class="hint" style="margin-top:10px;">${escapeHtml(regime.note)}</p>` : ""}
    </div>`;
}

// Repérage de mots-clés associés à une actualité potentiellement majeure (réglementation,
// sécurité, macro/Fed, déblocages de jetons, mouvements de prix extrêmes...) — classification
// MÉCANIQUE sur le texte réel du titre déjà collecté, jamais une évaluation de sens
// (bullish/bearish) : un même mot ("hawkish", "crackdown") peut jouer différemment selon le
// contexte complet de l'article, que seule la routine (qui lit au-delà du titre) peut vraiment
// juger — voir le champ sentiment sur data/alerts.json pour ça. Sert seulement à faire
// ressortir visuellement un titre qui mérite un coup d'œil plutôt que de laisser tout se noyer
// dans la liste, demandé explicitement par l'utilisateur ("si il y'a une grosse annonce...").
const NEWS_IMPORTANCE_KEYWORDS = [
  "sec ", "lawsuit", " ban", "banned", "crackdown", "sanction", "indict", "settlement",
  "approv", "reject", "etf ", "inflow", "outflow",
  "hack", "exploit", "breach", "stolen", "drained",
  "unlock", "airdrop", "halving",
  "fed ", "fomc", "hawkish", "dovish", "rate cut", "rate hike", "interest rate",
  "record high", "record low", "all-time high", "all-time low", " crash", "plunge", "surge",
  "bankrupt", "insolven", "delist", "acquisition", "acquire",
];
function isNewsImportant(title) {
  const t = ` ${(title || "").toLowerCase()} `;
  return NEWS_IMPORTANCE_KEYWORDS.some((kw) => t.includes(kw));
}

function renderNews(newsData) {
  const el = document.getElementById("news-body");
  if (!el) return;
  const items = (newsData && newsData.items) || [];
  if (items.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucune actualité récupérée pour l'instant — alimenté par la routine à chaque cycle profond.</p>`;
    return;
  }
  el.innerHTML = items
    .map((n) => {
      const url = safeUrl(n.url);
      const title = escapeHtml(n.title);
      const important = isNewsImportant(n.title);
      return `
      <div class="news-item${important ? " important" : ""}">
        ${important ? `<span class="news-important-flag" title="Contient un mot-clé associé à une actualité potentiellement majeure">⚡ À surveiller</span>` : ""}
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span>${title}</span>`}
        <span class="hint">${escapeHtml(n.source || "")}</span>
      </div>`;
    })
    .join("");
}

// Anime un chiffre de sa valeur affichée actuelle vers sa nouvelle valeur, plutôt qu'un
// remplacement sec — repli immédiat sur la valeur finale sans animation si requestAnimationFrame
// est absent (jsdom en test) ou si l'utilisateur préfère moins de mouvement.
function animateCountUp(el, target, duration = 700) {
  if (!el) return;
  const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!window.requestAnimationFrame || prefersReduced) {
    el.textContent = target;
    return;
  }
  const start = parseInt(el.textContent, 10) || 0;
  if (start === target) {
    el.textContent = target;
    return;
  }
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function updateHeroStats(verdicts, alerts) {
  const verdictsEl = document.getElementById("hero-verdicts");
  const alertsEl = document.getElementById("hero-alerts");
  if (verdictsEl) animateCountUp(verdictsEl, verdicts.length);
  if (alertsEl) animateCountUp(alertsEl, (alerts || []).length);
}

async function loadAllData() {
  const [verdicts, engineHistory, opportunities, alerts, news, controlGroup, marketContext, favorisContext, healthLog, digest, portfolio, portfolioThesis, portfolioHistory] = await Promise.all([
    loadJson(DATA_URLS.verdicts),
    loadJson(DATA_URLS.engineHistory),
    loadJson(DATA_URLS.opportunities),
    loadJson(DATA_URLS.alerts),
    loadJson(DATA_URLS.news),
    loadJson(DATA_URLS.controlGroup),
    loadJson(DATA_URLS.marketContext),
    loadJson(DATA_URLS.favorisContext),
    loadJson(DATA_URLS.healthLog),
    loadJson(DATA_URLS.digest),
    loadJson(DATA_URLS.portfolio),
    loadJson(DATA_URLS.portfolioThesis),
    loadJson(DATA_URLS.portfolioHistory),
  ]);
  latestFavorisContext = favorisContext;
  // Expose les données déjà chargées pour que d'autres fonctionnalités (l'Assistant) les
  // réutilisent sans refaire les mêmes fetch — toujours les données du dernier rafraîchissement.
  window.aguilaradarData = { verdicts, engineHistory, opportunities, alerts, news, controlGroup, marketContext, favorisContext, healthLog, digest, portfolio, portfolioThesis, portfolioHistory };
  if (window.renderDigestPanel) renderDigestPanel(digest);

  renderEngineTab(verdicts || [], engineHistory, opportunities, controlGroup);
  renderOpportunities(opportunities);
  renderJournal(verdicts || []);
  renderNotifications(alerts);
  renderAvisDuJour(alerts);
  if (window.updateNotifBellFromAlerts) updateNotifBellFromAlerts(alerts);
  renderNews(news);
  renderMacroRegime(engineHistory);
  renderMarketContext(marketContext);
  renderHealthStatus(healthLog);
  renderSectorBreakdown(verdicts || []);
  renderConfidenceHistory(verdicts || []);
  renderWeeklyDigest(verdicts || [], opportunities, alerts || []);
  renderProvisionalOverview(verdicts || []);
  initDayReplay({ verdicts: verdicts || [], opportunities, alerts: alerts || [] });
  updateHeroStats(verdicts || [], alerts);
  updateFavorisVerdicts(verdicts || []);
  if (window.renderPortfolio) renderPortfolio(portfolio, verdicts || [], portfolioThesis, portfolioHistory);

  updateFreshnessIndicator(engineHistory, opportunities, news);
}

// Sources suivies par l'indicateur de fraîcheur, chacune à SON PROPRE rythme attendu.
// opportunities.last_scan_at est passé à un rythme hebdomadaire le 17/08 (routine dédiée
// aguilaradar-opportunites-hebdo) — seuils en jours, pas en heures, pour ce champ précis.
const FRESHNESS_SOURCES = [
  { key: "routine", label: "Cycle profond", warnHours: 3, staleHours: 6 },
  { key: "news", label: "Actualités", warnHours: 3, staleHours: 6 },
  { key: "opportunities", label: "Criblage opportunités", warnHours: 24 * 8, staleHours: 24 * 10 },
];

// Indicateur de fraîcheur bien visible : plusieurs routines à cadences différentes
// alimentent le site, donc un écart anormal sur N'IMPORTE LAQUELLE (routine bloquée,
// silencieuse) doit se voir d'un coup d'oeil ici plutôt que de se découvrir des jours plus
// tard en remarquant que les actualités ou les opportunités sont figées. Régression du
// 17/08 : prendre le timestamp le PLUS RÉCENT des trois masquait indéfiniment une source
// bloquée tant qu'une autre tournait normalement (ex: routine_health frais toutes les 2h
// pendant qu'opportunities.last_scan_at restait figé 10 jours) — chaque source est donc
// désormais jugée indépendamment contre son propre rythme, et on affiche la pire.
function updateFreshnessIndicator(engineHistory, opportunities, news) {
  const timestampsByKey = {
    routine: engineHistory && engineHistory.routine_health && engineHistory.routine_health.last_success_at,
    news: news && (news.last_checked_at || news.last_updated_at),
    opportunities: opportunities && opportunities.last_scan_at,
  };

  const lastDeepCycle = document.getElementById("last-deep-cycle");
  if (!lastDeepCycle) return;
  lastDeepCycle.classList.remove("freshness-ok", "freshness-warning", "freshness-stale");

  const evaluated = FRESHNESS_SOURCES.map((source) => ({ ...source, at: timestampsByKey[source.key] }))
    .filter((source) => source.at)
    .map((source) => {
      const hoursSince = (Date.now() - new Date(source.at).getTime()) / 3600000;
      const status = hoursSince > source.staleHours ? "stale" : hoursSince > source.warnHours ? "warning" : "ok";
      return { ...source, hoursSince, status };
    });

  if (evaluated.length === 0) {
    lastDeepCycle.textContent = "Automatisation pas encore activée — routine programmée à configurer.";
    return;
  }

  const severity = { ok: 0, warning: 1, stale: 2 };
  const worst = evaluated.reduce((a, b) => (severity[b.status] > severity[a.status] ? b : a));
  const formatted = new Date(worst.at).toLocaleString("fr-FR");
  const elapsed = worst.hoursSince >= 48 ? Math.round(worst.hoursSince / 24) + " j" : worst.hoursSince.toFixed(0) + " h";

  lastDeepCycle.classList.add("freshness-" + worst.status);
  if (worst.status === "ok") {
    lastDeepCycle.textContent = worst.label + " : " + formatted + " — à jour";
  } else {
    const tail = worst.status === "stale" ? "la routine semble bloquée" : "un peu en retard";
    lastDeepCycle.textContent =
      (worst.status === "stale" ? "⚠ " : "") + worst.label + " : " + formatted + " (il y a " + elapsed + " — " + tail + ")";
  }
}

let refreshInFlight = false;
async function refreshAll(indicatorEl) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  if (indicatorEl) indicatorEl.classList.add("spinning");
  try {
    // Sequentiel, pas Promise.all : le journal/moteur ont besoin des prix deja en memoire
    // (latestFavorisPrices) pour calculer la tendance provisoire au moment ou ils se dessinent.
    await refreshPrices();
    await loadAllData();
  } finally {
    if (indicatorEl) {
      setTimeout(() => indicatorEl.classList.remove("spinning"), 300);
    }
    refreshInFlight = false;
  }
}

function initPullToRefresh() {
  const indicator = document.getElementById("pull-indicator");
  const threshold = 70;
  let startY = 0;
  let pulling = false;
  let triggered = false;

  document.addEventListener(
    "touchstart",
    (e) => {
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
        triggered = false;
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0 && window.scrollY === 0) {
        const dist = Math.min(dy, 110);
        indicator.style.opacity = Math.min(dist / threshold, 1);
        indicator.style.transform = `translateX(-50%) translateY(${dist - 34}px) rotate(${dist * 2}deg)`;
        triggered = dist > threshold;
      }
    },
    { passive: true }
  );

  document.addEventListener("touchend", () => {
    if (pulling && triggered) refreshAll(indicator);
    pulling = false;
    indicator.style.opacity = "0";
    indicator.style.transform = "translateX(-50%) translateY(-40px)";
  });
}

// Accordéon exclusif de l'onglet Moteur (piste "priorité") : un seul panneau ouvert à la
// fois, transition gérée en JS (comme .detail-panel) plutôt qu'un <details> natif, pour
// garder l'ouverture/fermeture fluide au lieu du repli instantané du navigateur.
function initExclusiveAccordion(container) {
  if (!container) return;
  const accs = Array.from(container.querySelectorAll(".engine-acc"));
  accs.forEach((acc) => {
    const btn = acc.querySelector(".engine-acc-summary");
    const body = acc.querySelector(".engine-acc-body");
    btn.addEventListener("click", () => {
      const wasOpen = body.classList.contains("open");
      accs.forEach((other) => {
        other.querySelector(".engine-acc-body").classList.remove("open");
        other.querySelector(".engine-acc-summary").setAttribute("aria-expanded", "false");
      });
      if (!wasOpen) {
        body.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
}

async function initApp() {
  document.querySelectorAll("nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  initExclusiveAccordion(document.getElementById("engine-accordion"));
  if (window.initThemeSwitcher) initThemeSwitcher();
  if (window.initLayoutSwitcher) initLayoutSwitcher();
  if (window.initCacheClearButton) initCacheClearButton();
  if (window.renderNotifPermissionCard) renderNotifPermissionCard();

  const refreshBtn = document.getElementById("refresh-btn");
  refreshBtn.addEventListener("click", () => refreshAll(refreshBtn));

  const bellBtn = document.getElementById("notif-bell-btn");
  if (bellBtn) bellBtn.addEventListener("click", () => switchTab("notifications"));
  initPullToRefresh();
  initSearch();
  if (window.initAssistant) initAssistant();

  if (window.initCardTilt) initCardTilt();
  if (window.registerConstellation) {
    registerConstellation("favoris", createConstellationController("favoris-constellation-canvas", () => FAVORIS.map((f) => f.ticker)));
    registerConstellation("opportunities", createConstellationController("opp-constellation-canvas", () => latestOpportunityTickers));
  }

  renderFavorisGrid();
  if (window.renderTransactionCalculator) renderTransactionCalculator();
  await refreshPrices();
  if (!pricesIntervalStarted) {
    setInterval(refreshPrices, 60000);
    pricesIntervalStarted = true;
  }

  await loadAllData();
}

window.initApp = initApp;
