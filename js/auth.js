// Portail d'accès. Voir README "Portail d'accès" : filtre les visiteurs occasionnels,
// n'est pas une sécurité réelle sur un dépôt public. Redemande le code a chaque VRAIE
// visite (onglet/fenetre ferme puis rouvert) mais pas a chaque interaction : sessionStorage
// survit aux rechargements de page au sein du meme onglet (frequents sur mobile/PWA des
// qu'on tape quelque chose), contrairement a localStorage (jamais efface, corrige avant
// pour l'inverse) qui ne redemandait plus jamais rien.

const ACCESS_SESSION_KEY = "aguilaradar_access_ok";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isUnlocked() {
  try {
    return sessionStorage.getItem(ACCESS_SESSION_KEY) === "1";
  } catch (e) {
    return false; // navigation privee ou stockage bloque : redemande simplement le code
  }
}

function showApp() {
  document.getElementById("access-gate").style.display = "none";
  document.getElementById("app-root").style.display = "";
  if (window.initApp) window.initApp();
}

function initGate() {
  if (window.initRadarBackground) initRadarBackground();

  if (isUnlocked()) {
    showApp();
    return;
  }

  const form = document.getElementById("access-form");
  const input = document.getElementById("access-input");
  const error = document.getElementById("access-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hash = await sha256Hex(input.value.trim());
    if (hash === ACCESS_HASH) {
      try {
        sessionStorage.setItem(ACCESS_SESSION_KEY, "1");
      } catch (e) {
        // stockage indisponible : tant pis, ca redemandera simplement au prochain chargement
      }
      showApp();
    } else {
      error.textContent = "Code incorrect.";
      input.value = "";
      input.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", initGate);
