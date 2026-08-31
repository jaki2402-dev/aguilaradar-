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
    const n = new Notification(title, { body, tag, icon: "apple-touch-icon.png" });
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

// Résumé périodique (data/digest.json, régénéré par une routine dédiée toutes les ~6h) :
// synthèse de toutes les données du site (verdicts, opportunités, contexte marché, favoris)
// avec quelques conseils. On notifie dès qu'un nouveau digest apparaît (un seul à la fois,
// pas de risque d'avalanche comme pour les opportunités).
const DIGEST_SEEN_KEY = "aguilaradar_digest_last_seen";

function loadSeenDigestId() {
  try {
    return localStorage.getItem(DIGEST_SEEN_KEY) || "";
  } catch (e) {
    return "";
  }
}

function saveSeenDigestId(id) {
  try {
    localStorage.setItem(DIGEST_SEEN_KEY, id);
  } catch (e) {}
}

// --- Cloche récapitulative dans l'en-tête : indique en un coup d'œil s'il y a du nouveau
// à voir dans l'onglet Notifications (alertes + résumé périodique), sans avoir à y aller.
const NOTIF_LAST_VIEWED_KEY = "aguilaradar_notif_last_viewed_at";
let lastKnownAlerts = [];
let lastKnownDigest = null;

function loadLastViewedAt() {
  try {
    return localStorage.getItem(NOTIF_LAST_VIEWED_KEY) || "";
  } catch (e) {
    return "";
  }
}

function saveLastViewedAt(iso) {
  try {
    localStorage.setItem(NOTIF_LAST_VIEWED_KEY, iso);
  } catch (e) {}
}

function updateNotifBellBadge() {
  const badge = document.getElementById("notif-bell-badge");
  if (!badge) return;
  // Première fois (aucun historique) : on prend "maintenant" comme référence plutôt que
  // de compter tout l'historique existant d'un coup (même logique que les autres baselines
  // de ce fichier, pour ne pas surprendre un nouvel utilisateur avec "9+" d'un coup).
  let lastViewed = loadLastViewedAt();
  if (!lastViewed) {
    lastViewed = new Date().toISOString();
    saveLastViewedAt(lastViewed);
  }
  const lastViewedTime = new Date(lastViewed).getTime();
  let count = (lastKnownAlerts || []).filter((a) => new Date(a.triggered_at).getTime() > lastViewedTime).length;
  if (lastKnownDigest && lastKnownDigest.generated_at && new Date(lastKnownDigest.generated_at).getTime() > lastViewedTime) {
    count += 1;
  }
  if (count > 0) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function clearNotifBellBadge() {
  saveLastViewedAt(new Date().toISOString());
  updateNotifBellBadge();
}

function updateNotifBellFromAlerts(alerts) {
  lastKnownAlerts = alerts || [];
  updateNotifBellBadge();
}

function renderDigestPanel(digest) {
  lastKnownDigest = digest;
  updateNotifBellBadge();
  const el = document.getElementById("digest-panel");
  if (!el) return;
  if (!digest || !digest.generated_at) {
    el.innerHTML = "";
    return;
  }
  const tone = digest.market_tone || "neutre";
  const tipsHtml = (digest.tips || [])
    .map((t) => `<li>${highlightKeyInfo(t)}</li>`)
    .join("");
  el.innerHTML = `
    <div class="digest-head">
      <span class="digest-tone digest-tone--${escapeHtml(tone)}">${escapeHtml(tone.toUpperCase())}</span>
      <span class="hint">Résumé généré le ${new Date(digest.generated_at).toLocaleString("fr-FR")}</span>
    </div>
    <h3 class="digest-headline">${highlightKeyInfo(digest.headline || "")}</h3>
    <p class="digest-summary">${highlightKeyInfo(digest.summary || "")}</p>
    ${tipsHtml ? `<ul class="digest-tips">${tipsHtml}</ul>` : ""}
  `;
}

async function checkDigest() {
  const digest = await loadJson(DATA_URLS.digest);
  if (!digest || !digest.generated_at) return;
  renderDigestPanel(digest);
  const seen = loadSeenDigestId();
  if (digest.generated_at !== seen) {
    saveSeenDigestId(digest.generated_at);
    if (seen) sendBrowserNotification(digest.headline || "Résumé du marché", digest.summary || "", "aguilaradar-digest");
  }
}

// --- Vrai push (notifications même app fermée) -----------------------------------------
// Nécessite un service worker + un abonnement navigateur (mécanisme standard et gratuit
// d'iOS/Safari, pas un service payant). Ce site est statique (GitHub Pages, sans serveur) :
// personne ne peut recevoir automatiquement l'abonnement créé par le navigateur. Étape unique
// à faire une fois : copier le code affiché après activation et l'envoyer dans la conversation.
// Clé PUBLIQUE uniquement (sans danger dans le code, elle sert juste à identifier l'expéditeur
// autorisé) — la clé privée correspondante ne vit jamais ici ni ailleurs dans ce dépôt public.
// Régénérée le 19/08 (l'ancienne n'avait plus sa clé privée associée nulle part de disponible).
const PUSH_VAPID_PUBLIC_KEY = "BFwuh-Ao68LmidWIrLvpZ4R0MoB7D9g6h-hnIdE75c9YVgcgSDgMRaE4Ctvn8Tg66MxIa_6lCpgbx3smkKhwI-Y";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

async function getExistingPushSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch (e) {
    return null;
  }
}

async function subscribeToPush() {
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const subscribePromise = reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY),
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Délai dépassé, réessaie.")), 20000)
  );
  return Promise.race([subscribePromise, timeout]);
}

function renderPushSection(subscription) {
  const el = document.getElementById("push-section");
  if (!el) return;
  if (!pushSupported()) {
    el.innerHTML = "";
    return;
  }

  if (!subscription) {
    el.innerHTML = `
      <button type="button" id="push-enable-btn" class="notif-enable-btn">Activer aussi app fermée</button>
      <p class="hint" style="margin-top:8px;">Reçois le résumé périodique même quand AguilaRadar est complètement fermé. Étape unique après activation : copier un code et me l'envoyer dans la conversation.</p>`;
    const btn = document.getElementById("push-enable-btn");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Activation…";
        try {
          const sub = await subscribeToPush();
          renderPushSection(sub);
        } catch (e) {
          console.error("Abonnement push impossible :", e);
          btn.disabled = false;
          btn.textContent = "Activer aussi app fermée";
          el.insertAdjacentHTML(
            "beforeend",
            `<p class="hint push-error">Échec de l'activation. Réessaie depuis l'app ouverte via l'icône ajoutée à l'écran d'accueil.</p>`
          );
        }
      });
    }
    return;
  }

  const subText = JSON.stringify(subscription.toJSON());
  el.innerHTML = `
    <div class="notif-status"><span class="badge badge-success">APP FERMÉE ACTIVÉE</span><span class="hint">Dernière étape (une seule fois) : copie ce code et envoie-le moi dans la conversation pour terminer la liaison. Déjà fait ? Rien d'autre à faire.</span></div>
    <textarea id="push-sub-text" class="push-sub-text" readonly rows="3">${subText}</textarea>
    <button type="button" id="push-copy-btn" class="notif-enable-btn">Copier le code</button>
    <button type="button" id="push-reset-btn" class="notif-enable-btn notif-reset-btn">Régénérer le code</button>
    <p class="hint" style="margin-top:6px;">"Régénérer" seulement si on te le demande explicitement (ex: après une mise à jour technique) — sinon inutile, le code déjà envoyé reste valable.</p>
  `;
  const copyBtn = document.getElementById("push-copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(subText);
        copyBtn.textContent = "Copié";
        setTimeout(() => {
          copyBtn.textContent = "Copier le code";
        }, 2000);
      } catch (e) {
        const ta = document.getElementById("push-sub-text");
        if (ta) {
          ta.focus();
          ta.select();
        }
      }
    });
  }
  const resetBtn = document.getElementById("push-reset-btn");
  if (resetBtn) {
    // Sans ce bouton, il n'existait aucun moyen de forcer un nouvel abonnement : une fois la
    // permission accordée, le navigateur renvoie toujours le MÊME abonnement existant (lié à
    // la clé publique utilisée lors de la toute première activation) — même si la clé publique
    // du site change depuis (ex: régénération de clé). unsubscribe() puis un nouvel appel à
    // subscribeToPush() force un abonnement réellement neuf, lié à la clé actuelle.
    resetBtn.addEventListener("click", async () => {
      resetBtn.disabled = true;
      resetBtn.textContent = "Régénération…";
      try {
        await subscription.unsubscribe();
        const fresh = await subscribeToPush();
        renderPushSection(fresh);
      } catch (e) {
        console.error("Régénération de l'abonnement push impossible :", e);
        resetBtn.disabled = false;
        resetBtn.textContent = "Régénérer le code";
      }
    });
  }
}

async function initPushSection() {
  const el = document.getElementById("push-section");
  if (!pushSupported() || notifPermissionStatus() !== "granted") {
    if (el) el.innerHTML = "";
    return;
  }
  const sub = await getExistingPushSubscription();
  renderPushSection(sub);
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
    checkDigest();
  };
  poll();
  initPushSection();
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
