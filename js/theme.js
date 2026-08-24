// Système de thèmes visuels du fond d'écran — voir js/bg-galaxy-3d.js (Galaxie 3D, thème par
// défaut), js/background-fx.js (Classique, fond d'origine du site, entièrement conservé, jamais
// supprimé, un clic pour y revenir) et js/bg-themes-extra.js (Aurore, Grille Cyber, Minimaliste).
// Choix mémorisé en localStorage : survit aux visites, contrairement à sessionStorage utilisé
// pour le portail d'accès (voir auth.js).
//
// mountActiveBackground() est appelée à deux moments : au chargement de la page, AVANT même le
// portail d'accès (le fond doit être "toujours présent, portail comme app", même logique que
// l'ancien fond radar — voir auth.js), et en direct depuis le panneau de réglages, sans
// recharger la page.

const THEME_STORAGE_KEY = "aguilaradar_theme";
const DEFAULT_THEME = "galaxy";

// id -> id du <canvas> dédié (voir index.html) : un même canvas ne peut avoir qu'UN SEUL type
// de contexte (2D ou WebGL) sur toute sa vie, d'où un élément distinct par thème plutôt qu'un
// seul réutilisé — voir le commentaire original plus bas sur mountActiveBackground().
const THEMES = [
  {
    id: "galaxy",
    label: "Galaxie 3D",
    description: "Un vrai fond spatial en 3D — étoiles, planètes en orbite, animé en continu.",
    canvasId: "bg-galaxy-canvas",
    swatch: "linear-gradient(135deg, #05070b 40%, #7c9eff 75%, #f0b429)",
  },
  {
    id: "aurora",
    label: "Aurore",
    description: "Bandes de couleur douces façon aurore boréale, esprit plus onirique que la Galaxie 3D.",
    canvasId: "bg-aurora-canvas",
    swatch: "linear-gradient(90deg, #2fd3b0, #22b8e0, #b48cf2, #f277b3, #f0b429)",
  },
  {
    id: "cyber",
    label: "Grille Cyber",
    description: "Plancher en perspective façon HUD, dans l'esprit instrument du site.",
    canvasId: "bg-cyber-canvas",
    swatch: "linear-gradient(135deg, #05070b 45%, #2fd3b0 80%, #22b8e0)",
  },
  {
    id: "classic",
    label: "Classique",
    description: "Le fond d'origine du site — icônes des favoris à la dérive et balayage radar.",
    canvasId: "bg-radar-canvas",
    swatch: "linear-gradient(135deg, #05070b 45%, #2fd3b0 75%, #f0b429)",
  },
  {
    id: "minimal",
    label: "Minimaliste",
    description: "Une seule lueur discrète, quasi statique — pour un fond calme et sobre.",
    canvasId: "bg-minimal-canvas",
    swatch: "radial-gradient(circle at 30% 30%, rgba(47,211,176,0.55), #05070b 70%)",
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

// Chaque thème s'enregistre lui-même dans window.AguilaBackgrounds (voir bg-galaxy-3d.js,
// bg-themes-extra.js, et l'adaptateur en bas de background-fx.js pour "classic") avec la même
// forme { mount(canvas), unmount(), isActive() } — theme.js n'a donc plus besoin de connaître
// les particularités de chaque fond, seulement cette API commune et la liste THEMES ci-dessus.
function unmountAllBackgrounds() {
  if (!window.AguilaBackgrounds) return;
  Object.values(window.AguilaBackgrounds).forEach((handler) => {
    if (handler && handler.isActive && handler.isActive()) handler.unmount();
  });
}

function hideAllThemeCanvases() {
  THEMES.forEach((t) => {
    const el = document.getElementById(t.canvasId);
    if (el) el.hidden = true;
  });
}

function mountActiveBackground() {
  const theme = THEMES.find((t) => t.id === getActiveTheme()) || THEMES.find((t) => t.id === DEFAULT_THEME);
  unmountAllBackgrounds();
  hideAllThemeCanvases();

  const handler = window.AguilaBackgrounds && window.AguilaBackgrounds[theme.id];
  const canvas = document.getElementById(theme.canvasId);
  if (handler && canvas) {
    canvas.hidden = false;
    handler.mount(canvas);
    if (handler.isActive && handler.isActive()) return;
    canvas.hidden = true;
    // Montage réellement échoué (WebGL absent, mouvement réduit demandé...) : jamais laisser
    // un fond vide, on retombe sur Classique plutôt que de forcer un choix cassé.
  }
  const classic = THEMES.find((t) => t.id === "classic");
  const classicCanvas = document.getElementById(classic.canvasId);
  const classicHandler = window.AguilaBackgrounds && window.AguilaBackgrounds.classic;
  if (classicCanvas && classicHandler) {
    classicCanvas.hidden = false;
    classicHandler.mount(classicCanvas);
  }
}

function renderThemeList() {
  const list = document.getElementById("design-theme-list");
  if (!list) return;
  const active = getActiveTheme();
  list.innerHTML = THEMES.map(
    (t) => `
    <button type="button" class="design-theme-card${t.id === active ? " active" : ""}" data-theme-id="${t.id}">
      <span class="design-theme-swatch" style="background:${escapeHtml(t.swatch)}"></span>
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
