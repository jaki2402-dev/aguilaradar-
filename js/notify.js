// Notifications navigateur pour les opportunités : prévient dès qu'une nouvelle opportunité
// (criblage Top 300) ou un signal précoce sur un favori apparaît, tant qu'AguilaRadar reste
// ouvert (onglet ou app installée), même en arrière-plan. Pas de vrai push app fermée — ça
// demanderait un serveur dédié, ce que ce site (statique, GitHub Pages) n'a pas.

const NOTIF_SEEN_KEY = "aguilaradar_notif_seen_ids";
const NOTIF_POLL_MS = 5 * 60 * 1000;

function loadSeenNotifIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIF_SEEN_KEY) || "[]"));
  } catch (e) {
    return new Set();
  }
}

function saveSeenNotifIds(set) {
  try {
    localStorage.setItem(NOTIF_SEEN_KEY, JSON.stringify(Array.from(set).slice(-300)));
  } catch (e) {}
}

function notifSupported() {
  return typeof Notification !== "undefined";
}

function notifPermissionStatus() {
  if (!notifSupported()) return "unsupported";
  return Notification.permission;
}

function sendBrowserNotification(title, body, tag) {
  if (!notifSupported() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag, icon: "favicon.svg" });
    n.onclick = () => {
      window.focus();
      if (window.switchTab) switchTab("notifications");
      n.close();
    };
  } catch (e) {
    console.error("Notification impossible :", e);
  }
}

// isBaseline = true lors du tout premier sondage : on enregistre ce qui existe déjà sans
// notifier, sinon un nouvel utilisateur reçoit 8 notifications d'un coup à l'activation.
function checkForNewOpportunities(opportunitiesData, alerts, isBaseline) {
  const seen = loadSeenNotifIds();
  let changed = false;
  const relevant = [];

  ((opportunitiesData && opportunitiesData.opportunities) || []).forEach((o) => {
    relevant.push({
      id: "opp-" + (o.id || o.ticker),
      title: "Nouvelle opportunité",
      body: `${o.ticker} — ${o.reason || "détectée par le criblage"}`,
    });
  });

  (alerts || []).forEach((a) => {
    if (a.type !== "opportunite" && a.type !== "signal_precoce") return;
    relevant.push({
      id: "alert-" + (a.id || `${a.type}-${a.triggered_at}-${a.ticker_ou_theme || a.ticker || ""}`),
      title: a.type === "signal_precoce" ? "Signal précoce sur un favori" : "Opportunité détectée",
      body: a.message,
    });
  });

  relevant.forEach((item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    changed = true;
    if (!isBaseline) sendBrowserNotification(item.title, item.body, item.id);
  });

  if (changed) saveSeenNotifIds(seen);
}

let notifPollTimer = null;
let notifBaselineDone = false;
function startNotifPolling() {
  if (notifPollTimer) return;
  const poll = async () => {
    const [opportunities, alerts] = await Promise.all([
      loadJson(DATA_URLS.opportunities),
      loadJson(DATA_URLS.alerts),
    ]);
    checkForNewOpportunities(opportunities, alerts, !notifBaselineDone);
    notifBaselineDone = true;
  };
  poll();
  notifPollTimer = setInterval(poll, NOTIF_POLL_MS);
}

function renderNotifPermissionCard() {
  const el = document.getElementById("notif-permission-card");
  if (!el) return;
  const status = notifPermissionStatus();

  if (status === "unsupported") {
    el.innerHTML = `<p class="hint">Les notifications ne sont pas prises en charge par ce navigateur.</p>`;
    return;
  }
  if (status === "granted") {
    el.innerHTML = `<div class="notif-status"><span class="badge badge-success">ACTIVÉES</span><span class="hint">Une notification s'affiche pour toute nouvelle opportunité ou signal précoce sur un favori, tant qu'AguilaRadar reste ouvert (même en arrière-plan). Ne fonctionne pas app totalement fermée.</span></div>`;
    startNotifPolling();
    return;
  }
  if (status === "denied") {
    el.innerHTML = `<div class="notif-status"><span class="badge badge-warning">BLOQUÉES</span><span class="hint">Refusées au niveau du navigateur — à réactiver dans les réglages du site si tu changes d'avis.</span></div>`;
    return;
  }
  el.innerHTML = `
    <button type="button" id="notif-enable-btn" class="notif-enable-btn">Activer les notifications d'opportunités</button>
    <p class="hint" style="margin-top:8px;">Prévient dès qu'une nouvelle opportunité ou un signal précoce sur un favori apparaît, tant qu'AguilaRadar reste ouvert. Ne fonctionne pas app totalement fermée (ce site n'a pas de serveur pour ça).</p>`;
  const btn = document.getElementById("notif-enable-btn");
  if (btn) {
    btn.addEventListener("click", async () => {
      const result = await Notification.requestPermission();
      renderNotifPermissionCard();
      if (result === "granted") startNotifPolling();
    });
  }
}
