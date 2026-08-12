// Orchestration : navigation par onglets, chargement des données JSON, rendu.

const TABS = ["overview", "favoris", "opportunities", "journal", "engine", "notifications"];
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

function renderFavorisGrid() {
  const grid = document.getElementById("favoris-grid");
  grid.innerHTML = FAVORIS.map(
    (f) => `
    <div class="favori-card clickable" data-detail-target="detail-fav-${f.ticker}" style="--sector-color:${SECTOR_COLORS[f.cgId] || "var(--border)"}">
      <div class="favori-row">
        <div class="favori-row-tick">${f.ticker}</div>
        <div class="favori-row-mid">
          <div class="favori-row-name">${f.name}</div>
          <div class="favori-row-sector">${SECTORS[f.cgId] || ""}</div>
        </div>
        <span class="favori-row-badge" id="verdict-${f.ticker}"></span>
        <div class="favori-row-right">
          <div class="favori-price skeleton" id="price-${f.ticker}">0 000,00 €</div>
          <div class="chip skeleton" id="change-${f.ticker}">▲ +0,00 %</div>
        </div>
      </div>
      <div class="expand-hint">Voir le graphique et l'analyse détaillée <span class="chevron">▾</span></div>
      <div class="detail-panel" id="detail-fav-${f.ticker}"></div>
    </div>`
  ).join("");

  // Graphique TradingView chargé au tap (dans le panneau de détail), plus au chargement de
  // la page : 15 widgets simultanés étaient la principale cause du défilement lourd de cet
  // onglet — voir renderDetailPanel (detail.js) pour le montage effectif.
  document.querySelectorAll("#favoris-grid .favori-card.clickable").forEach((cardEl, i) => {
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
    const cardEl = chipEl.closest(".favori-card");
    if (cardEl) {
      cardEl.dataset.reasoning = latest.reasoning;
      cardEl.dataset.verdict = latest.verdict;
    }
  });
}

async function refreshPrices() {
  try {
    const prices = await fetchFavorisPrices();
    latestFavorisPrices = prices;
    FAVORIS.forEach((f) => {
      const p = prices[f.cgId];
      const priceEl = document.getElementById(`price-${f.ticker}`);
      const changeEl = document.getElementById(`change-${f.ticker}`);
      if (!p || !priceEl || !changeEl) return;
      priceEl.textContent = formatPrice(p.eur, "EUR");
      priceEl.classList.remove("skeleton");
      const change = p.eur_24h_change;
      changeEl.textContent = formatChangePct(change);
      changeEl.className = "chip skeleton-off " + (change >= 0 ? "positive" : "negative");
      changeEl.classList.remove("skeleton");
    });
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
  renderOpportunityCards("opportunities-body", items);
  renderOpportunityCards("accueil-highlights", items, 3);
  if (constellationControllers.opportunities) constellationControllers.opportunities.refresh();
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
      <div class="journal-entry clickable" data-detail-target="detail-journal-${v.id || i}" data-cgid="${v.asset}">
        <div class="log-header">
          <span><strong>${v.ticker || v.asset}</strong> · ${v.issued_at}</span>
          <span class="badge badge-${(v.verdict || "").toLowerCase()}">${v.verdict}</span>
        </div>
        <p>${escapeHtml(v.reasoning || "")}</p>
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
  opportunite: "Opportunité",
  signal_precoce: "Signal précoce",
  regime_change_impact: "Changement de régime",
};

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
      <div class="alert-entry">
        <div class="log-header">
          <span><strong>${a.ticker_ou_theme || a.ticker || ""}</strong> · ${a.triggered_at}</span>
          <span class="badge badge-warning">${ALERT_TYPE_LABELS[a.type] || a.type}</span>
        </div>
        <p>${escapeHtml(a.message)}</p>
        ${a.source ? `<p class="hint">Source : ${escapeHtml(a.source)}</p>` : ""}
      </div>`
      )
      .join("") +
    (remaining > 0
      ? `<div class="expand-hint clickable" id="notifications-load-more">Voir ${Math.min(remaining, NOTIFICATIONS_PAGE_SIZE)} alerte(s) de plus (${remaining} restante${remaining > 1 ? "s" : ""}) <span class="chevron">▾</span></div>`
      : `<p class="hint" style="text-align:center; margin-top:12px;">${notificationsSorted.length} alerte(s) au total, historique permanent.</p>`);

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
      <div class="hint">Régime de marché actuel</div>
      <div class="hero-stats">
        <div><div class="hero-stat-value ${cls}">${REGIME_LABELS[regime.regime] || regime.regime}</div><div class="hero-stat-label">Contexte macro</div></div>
        <div><div class="hero-stat-value">${regime.fear_greed_value ?? "—"}</div><div class="hero-stat-label">Fear &amp; Greed</div></div>
        <div><div class="hero-stat-value">${regime.btc_dominance_pct !== null && regime.btc_dominance_pct !== undefined ? regime.btc_dominance_pct.toFixed(1) + " %" : "—"}</div><div class="hero-stat-label">Dominance BTC</div></div>
      </div>
      ${regime.note ? `<p class="hint" style="margin-top:10px;">${escapeHtml(regime.note)}</p>` : ""}
    </div>`;
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
      return `
      <div class="news-item">
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span>${title}</span>`}
        <span class="hint">${escapeHtml(n.source || "")}</span>
      </div>`;
    })
    .join("");
}

function updateHeroStats(verdicts, alerts) {
  const verdictsEl = document.getElementById("hero-verdicts");
  const alertsEl = document.getElementById("hero-alerts");
  if (verdictsEl) verdictsEl.textContent = verdicts.length;
  if (alertsEl) alertsEl.textContent = (alerts || []).length;
}

async function loadAllData() {
  const [verdicts, engineHistory, opportunities, alerts, news, controlGroup, marketContext, favorisContext, healthLog, digest] = await Promise.all([
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
  ]);
  latestFavorisContext = favorisContext;
  if (window.renderDigestPanel) renderDigestPanel(digest);

  renderEngineTab(verdicts || [], engineHistory, opportunities, controlGroup);
  renderOpportunities(opportunities);
  renderJournal(verdicts || []);
  renderNotifications(alerts);
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

  const timestamps = [
    engineHistory && engineHistory.global_stats && engineHistory.global_stats.last_computed_at,
    opportunities && opportunities.last_scan_at,
  ].filter(Boolean);
  const lastDeepCycle = document.getElementById("last-deep-cycle");
  lastDeepCycle.textContent = timestamps.length
    ? "Dernière analyse profonde : " + new Date(Math.max(...timestamps.map((t) => new Date(t)))).toLocaleString("fr-FR")
    : "Automatisation pas encore activée — routine programmée à configurer.";
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
  if (window.renderNotifPermissionCard) renderNotifPermissionCard();

  const refreshBtn = document.getElementById("refresh-btn");
  refreshBtn.addEventListener("click", () => refreshAll(refreshBtn));

  const bellBtn = document.getElementById("notif-bell-btn");
  if (bellBtn) bellBtn.addEventListener("click", () => switchTab("notifications"));
  initPullToRefresh();
  initSearch();

  if (window.initCardTilt) initCardTilt();
  if (window.registerConstellation) {
    registerConstellation("favoris", createConstellationController("favoris-constellation-canvas", () => FAVORIS.map((f) => f.ticker)));
    registerConstellation("opportunities", createConstellationController("opp-constellation-canvas", () => latestOpportunityTickers));
  }

  renderFavorisGrid();
  await refreshPrices();
  if (!pricesIntervalStarted) {
    setInterval(refreshPrices, 60000);
    pricesIntervalStarted = true;
  }

  await loadAllData();
}

window.initApp = initApp;
