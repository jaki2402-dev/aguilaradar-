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

function renderFavorisGrid() {
  const grid = document.getElementById("favoris-grid");
  grid.innerHTML = FAVORIS.map(
    (f) => `
    <div class="favori-card clickable" data-detail-target="detail-fav-${f.ticker}">
      <div class="favori-header">
        <div>
          <span class="favori-ticker">${f.ticker}</span>
          <span class="favori-name">${f.name}</span>
        </div>
        <div class="favori-price skeleton" id="price-${f.ticker}">0 000,00 €</div>
      </div>
      <div class="chip skeleton" id="change-${f.ticker}">▲ +0,00 %</div>
      <div class="tv-chart" id="tv-${f.ticker}"></div>
      <div class="favori-verdict empty-state" id="verdict-${f.ticker}">Verdict en attente du premier cycle d'analyse automatisé.</div>
      <div class="expand-hint">Voir l'analyse détaillée <span class="chevron">▾</span></div>
      <div class="detail-panel" id="detail-fav-${f.ticker}"></div>
    </div>`
  ).join("");

  FAVORIS.forEach((f) => mountTradingViewChart(`tv-${f.ticker}`, f.tvSymbol));

  document.querySelectorAll("#favoris-grid .favori-card.clickable").forEach((cardEl, i) => {
    const f = FAVORIS[i];
    attachDetailToggle(cardEl, `detail-fav-${f.ticker}`, { cgId: f.cgId, tvSymbol: f.tvSymbol, ticker: f.ticker, athChangePct: null, reasoning: null });
  });
}

function updateFavorisVerdicts(verdicts) {
  FAVORIS.forEach((f) => {
    const el = document.getElementById(`verdict-${f.ticker}`);
    if (!el) return;
    const latest = (verdicts || [])
      .filter((v) => v.asset === f.cgId)
      .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))[0];
    if (!latest) return;
    el.classList.remove("empty-state");
    el.innerHTML = `
      <span class="badge badge-${latest.verdict.toLowerCase()}">${latest.verdict}</span>
      <span class="hint">${latest.status === "pending" ? "en cours (horizon " + latest.horizon_days + " j)" : "résolu"} · confiance ${latest.confidence_pct} %</span>
      <p class="hint" style="margin-top:6px;">${latest.reasoning}</p>`;
    const cardEl = el.closest(".favori-card");
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

function renderJournal(verdicts) {
  const el = document.getElementById("journal-body");
  if (verdicts.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun verdict émis pour l'instant. Dès que la routine programmée sera active, chaque verdict apparaîtra ici et y restera de façon permanente.</p>`;
    return;
  }
  el.innerHTML = verdicts
    .slice()
    .reverse()
    .map(
      (v, i) => `
      <div class="journal-entry clickable" data-detail-target="detail-journal-${v.id || i}" data-cgid="${v.asset}">
        <div class="log-header">
          <span><strong>${v.ticker || v.asset}</strong> · ${v.issued_at}</span>
          <span class="badge badge-${(v.verdict || "").toLowerCase()}">${v.verdict}</span>
        </div>
        <p>${v.reasoning || ""}</p>
        <p class="hint">Confiance ${v.confidence_pct ?? "—"} % · horizon ${v.horizon_days} j · statut ${v.status}</p>
        ${v.status === "pending" ? renderProvisionalBadge(v) : ""}
        <div class="expand-hint">Voir l'analyse détaillée <span class="chevron">▾</span></div>
        <div class="detail-panel" id="detail-journal-${v.id || i}"></div>
      </div>`
    )
    .join("");

  const byPanelId = {};
  verdicts.forEach((v, i) => (byPanelId[`detail-journal-${v.id || i}`] = v));
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
}

const ALERT_TYPE_LABELS = {
  seuil_technique: "Seuil technique",
  actualite_macro: "Actu macro",
  actualite_favori: "Actu favori",
  opportunite: "Opportunité",
  signal_precoce: "Signal précoce",
  regime_change_impact: "Changement de régime",
};

function renderNotifications(alerts) {
  const el = document.getElementById("notifications-body");
  if (!alerts || alerts.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucune alerte active. La routine (toutes les 2h) déclenchera une notification ici pour un seuil technique franchi, une actualité macro ou sur un favori jugée significative, ou une opportunité forte — avec le signal et le pourquoi.</p>`;
    return;
  }
  el.innerHTML = alerts
    .slice()
    .reverse()
    .map(
      (a) => `
      <div class="alert-entry">
        <div class="log-header">
          <span><strong>${a.ticker_ou_theme || a.ticker || ""}</strong> · ${a.triggered_at}</span>
          <span class="badge badge-warning">${ALERT_TYPE_LABELS[a.type] || a.type}</span>
        </div>
        <p>${a.message}</p>
        ${a.source ? `<p class="hint">Source : ${a.source}</p>` : ""}
      </div>`
    )
    .join("");
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
      ${regime.note ? `<p class="hint" style="margin-top:10px;">${regime.note}</p>` : ""}
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
    .map(
      (n) => `
      <div class="news-item">
        <a href="${n.url}" target="_blank" rel="noopener noreferrer">${n.title}</a>
        <span class="hint">${n.source || ""}</span>
      </div>`
    )
    .join("");
}

function updateHeroStats(verdicts, alerts) {
  const verdictsEl = document.getElementById("hero-verdicts");
  const alertsEl = document.getElementById("hero-alerts");
  if (verdictsEl) verdictsEl.textContent = verdicts.length;
  if (alertsEl) alertsEl.textContent = (alerts || []).length;
}

async function loadAllData() {
  const [verdicts, engineHistory, opportunities, alerts, news, controlGroup, marketContext, favorisContext, healthLog] = await Promise.all([
    loadJson(DATA_URLS.verdicts),
    loadJson(DATA_URLS.engineHistory),
    loadJson(DATA_URLS.opportunities),
    loadJson(DATA_URLS.alerts),
    loadJson(DATA_URLS.news),
    loadJson(DATA_URLS.controlGroup),
    loadJson(DATA_URLS.marketContext),
    loadJson(DATA_URLS.favorisContext),
    loadJson(DATA_URLS.healthLog),
  ]);
  latestFavorisContext = favorisContext;

  renderEngineTab(verdicts || [], engineHistory, opportunities, controlGroup);
  renderOpportunities(opportunities);
  renderJournal(verdicts || []);
  renderNotifications(alerts);
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

async function initApp() {
  document.querySelectorAll("nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  const refreshBtn = document.getElementById("refresh-btn");
  refreshBtn.addEventListener("click", () => refreshAll(refreshBtn));
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
