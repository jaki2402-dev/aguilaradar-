// Portail d'accès. Voir README "Portail d'accès" : filtre les visiteurs occasionnels,
// n'est pas une sécurité réelle sur un dépôt public.

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isUnlocked() {
  return localStorage.getItem(ACCESS_STORAGE_KEY) === "1";
}

function showApp() {
  document.getElementById("access-gate").style.display = "none";
  document.getElementById("app-root").style.display = "";
  if (window.initApp) window.initApp();
}

function initGate() {
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
      localStorage.setItem(ACCESS_STORAGE_KEY, "1");
      showApp();
    } else {
      error.textContent = "Code incorrect.";
      input.value = "";
      input.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", initGate);
