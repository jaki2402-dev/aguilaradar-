// Système de thèmes visuels du fond d'écran — voir js/bg-galaxy-3d.js (Galaxie 3D, nouveau
// thème par défaut) et js/background-fx.js (Classique, fond d'origine du site, entièrement
// conservé, jamais supprimé, un clic pour y revenir). Choix mémorisé en localStorage : survit
// aux visites, contrairement à sessionStorage utilisé pour le portail d'accès (voir auth.js).
//
// mountActiveBackground() est appelée à deux moments : au chargement de la page, AVANT même le
// portail d'accès (le fond doit être "toujours présent, portail comme app", même logique que
// l'ancien fond radar — voir auth.js), et en direct depuis le panneau de réglages, sans
// recharger la page.

const THEME_STORAGE_KEY = "aguilaradar_theme";
const DEFAULT_THEME = "galaxy";

const THEMES = [
  {
    id: "galaxy",
    label: "Galaxie 3D",
    description: "Un vrai fond spatial en 3D — étoiles, planètes en orbite, animé en continu.",
  },
  {
    id: "classic",
    label: "Classique",
    description: "Le fond d'origine du site — icônes des favoris à la dérive et balayage radar.",
  },
];

function getActiveTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (THEMES.some((t) => t.id === stored)) return stored;
  } catch (e) {
    // Stockage indisponible (navigation privée, quota) : thème par défaut à chaque visite,
    // sans casser l'application pour autant.
  }
  return DEFAULT_THEME;
}

function setActiveTheme(id) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch (e) {
    // Le choix ne survivra pas à cette visite, mais l'application continue de fonctionner.
  }
}

// Poignée d'arrêt du fond Classique actuellement monté, s'il y en a un — initRadarBackground()
// (background-fx.js) renvoie désormais { stop() } pour permettre exactement ce démontage
// propre (avant ce changement, rien n'exposait de moyen d'arrêter sa boucle requestAnimationFrame).
let radarHandle = null;

function unmountAllBackgrounds() {
  if (window.AguilaBackgrounds && window.AguilaBackgrounds.galaxy) window.AguilaBackgrounds.galaxy.unmount();
  if (radarHandle) {
    radarHandle.stop();
    radarHandle = null;
  }
}

// Un même <canvas> ne peut avoir qu'UN SEUL type de contexte (2D ou WebGL) sur toute sa vie —
// d'où deux éléments distincts (#bg-radar-canvas pour Classique, #bg-galaxy-canvas pour
// Galaxie 3D) plutôt qu'un seul réutilisé entre les deux thèmes.
function mountActiveBackground() {
  const theme = getActiveTheme();
  unmountAllBackgrounds();
  const galaxyCanvas = document.getElementById("bg-galaxy-canvas");
  const radarCanvas = document.getElementById("bg-radar-canvas");

  if (theme === "galaxy" && galaxyCanvas && window.AguilaBackgrounds && window.AguilaBackgrounds.galaxy) {
    galaxyCanvas.hidden = false;
    if (radarCanvas) radarCanvas.hidden = true;
    window.AguilaBackgrounds.galaxy.mount(galaxyCanvas);
    const ok = window.AguilaBackgrounds.galaxy.isActive && window.AguilaBackgrounds.galaxy.isActive();
    if (ok) return;
    // Montage réellement échoué (WebGL absent, mouvement réduit demandé...) : jamais laisser
    // un fond vide, on retombe sur Classique plutôt que de forcer un choix cassé.
  }
  if (galaxyCanvas) galaxyCanvas.hidden = true;
  if (radarCanvas) radarCanvas.hidden = false;
  if (window.initRadarBackground) radarHandle = window.initRadarBackground();
}

function renderThemeList() {
  const list = document.getElementById("design-theme-list");
  if (!list) return;
  const active = getActiveTheme();
  list.innerHTML = THEMES.map(
    (t) => `
    <button type="button" class="design-theme-card${t.id === active ? " active" : ""}" data-theme-id="${t.id}">
      <span class="design-theme-name">${escapeHtml(t.label)}</span>
      <span class="design-theme-desc">${escapeHtml(t.description)}</span>
      <span class="design-theme-check">${t.id === active ? "✓ Actif" : ""}</span>
    </button>`
  ).join("");
  list.querySelectorAll(".design-theme-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.themeId === getActiveTheme()) return;
      setActiveTheme(btn.dataset.themeId);
      mountActiveBackground();
      renderThemeList();
    });
  });
}

function openDesignSettings() {
  const panel = document.getElementById("design-settings-panel");
  if (!panel) return;
  renderThemeList();
  panel.hidden = false;
}

function closeDesignSettings() {
  const panel = document.getElementById("design-settings-panel");
  if (panel) panel.hidden = true;
}

function initThemeSwitcher() {
  const btn = document.getElementById("design-settings-btn");
  const closeBtn = document.getElementById("design-settings-close");
  const panel = document.getElementById("design-settings-panel");
  const backdrop = panel ? panel.querySelector(".design-settings-backdrop") : null;
  if (btn) btn.addEventListener("click", openDesignSettings);
  if (closeBtn) closeBtn.addEventListener("click", closeDesignSettings);
  if (backdrop) backdrop.addEventListener("click", closeDesignSettings);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel && !panel.hidden) closeDesignSettings();
  });
}

window.mountActiveBackground = mountActiveBackground;
window.initThemeSwitcher = initThemeSwitcher;
