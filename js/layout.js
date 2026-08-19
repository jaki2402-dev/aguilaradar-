// Système de dispositions pour la grille Favoris — vit dans le même panneau "Réglages design"
// que le fond animé (voir theme.js), mais c'est un choix indépendant : il ne change que
// l'agencement CSS des tuiles déjà produites par renderFavorisGrid() (app.js), jamais leur
// contenu ni leur logique (teinte de chaleur, clic pour déplier...). Choix mémorisé en
// localStorage, appliqué au chargement et en direct depuis le panneau, sans recharger la page.

const LAYOUT_STORAGE_KEY = "aguilaradar_favoris_layout";
const DEFAULT_LAYOUT = "dense";

const LAYOUTS = [
  {
    id: "dense",
    label: "Grille dense",
    description: "Esprit Coin360 : un maximum de tuiles à l'écran, l'essentiel seulement.",
  },
  {
    id: "list",
    label: "Liste compacte",
    description: "Une ligne par crypto, ticker et prix alignés — pour scanner vite, comme un tableau.",
  },
  {
    id: "comfort",
    label: "Cartes confort",
    description: "Tuiles plus grandes et plus espacées, pour une lecture plus reposée.",
  },
];

function getActiveLayout() {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (LAYOUTS.some((l) => l.id === stored)) return stored;
  } catch (e) {
    // Stockage indisponible (navigation privée, quota) : disposition par défaut à chaque
    // visite, sans casser l'application pour autant.
  }
  return DEFAULT_LAYOUT;
}

function setActiveLayout(id) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, id);
  } catch (e) {
    // Le choix ne survivra pas à cette visite, mais l'application continue de fonctionner.
  }
}

const LAYOUT_CLASSES = LAYOUTS.map((l) => `layout-${l.id}`);

// La classe se pose sur #favoris-grid lui-même, jamais sur ses tuiles : renderFavorisGrid()
// (app.js) régénère le contenu via innerHTML à chaque rafraîchissement de données, ce qui ne
// touche jamais aux attributs de la grille elle-même — la disposition choisie survit donc
// automatiquement à chaque re-rendu, sans avoir à la ré-appliquer après coup.
function applyFavorisLayout(id) {
  const grid = document.getElementById("favoris-grid");
  if (!grid) return;
  grid.classList.remove(...LAYOUT_CLASSES);
  grid.classList.add(`layout-${id}`);
}

function renderLayoutList() {
  const list = document.getElementById("design-layout-list");
  if (!list) return;
  const active = getActiveLayout();
  list.innerHTML = LAYOUTS.map(
    (l) => `
    <button type="button" class="design-theme-card design-layout-card${l.id === active ? " active" : ""}" data-layout-id="${l.id}">
      <span class="design-theme-name">${escapeHtml(l.label)}</span>
      <span class="design-theme-desc">${escapeHtml(l.description)}</span>
      <span class="design-theme-check">${l.id === active ? "✓ Actif" : ""}</span>
    </button>`
  ).join("");
  list.querySelectorAll(".design-layout-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.layoutId === getActiveLayout()) return;
      setActiveLayout(btn.dataset.layoutId);
      applyFavorisLayout(btn.dataset.layoutId);
      renderLayoutList();
    });
  });
}

// Contrairement au panneau des thèmes (rendu à chaque ouverture, voir openDesignSettings dans
// theme.js), la liste des dispositions est rendue une fois au démarrage : pas de montage
// coûteux (WebGL...) derrière un simple bouton, donc aucune raison de différer le rendu tant
// que le panneau est fermé.
function initLayoutSwitcher() {
  applyFavorisLayout(getActiveLayout());
  renderLayoutList();
}

window.applyFavorisLayout = applyFavorisLayout;
window.initLayoutSwitcher = initLayoutSwitcher;
