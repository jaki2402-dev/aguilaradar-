import { describe, it, expect, beforeEach } from "vitest";
import { loadPage, getGlobal, runScript } from "./helpers/loadPage.js";

const FIXTURE_HTML = `<!doctype html><html><body>
  <canvas id="bg-radar-canvas"></canvas>
  <canvas id="bg-galaxy-canvas" hidden></canvas>
  <canvas id="bg-aurora-canvas" hidden></canvas>
  <canvas id="bg-cyber-canvas" hidden></canvas>
  <canvas id="bg-minimal-canvas" hidden></canvas>
  <button id="design-settings-btn"></button>
  <div id="design-settings-panel" hidden>
    <div class="design-settings-backdrop"></div>
    <div class="design-settings-card">
      <button id="design-settings-close"></button>
      <div class="design-theme-list" id="design-theme-list"></div>
      <button id="clear-cache-btn"></button>
    </div>
  </div>
</body></html>`;

// Chaque thème (galaxy, classic, aurora, cyber, minimal) s'enregistre lui-même dans
// window.AguilaBackgrounds avec la même forme { mount, unmount, isActive } — voir
// bg-galaxy-3d.js, l'adaptateur en bas de background-fx.js, et bg-themes-extra.js. Ces stubs
// simulent cette même forme sans dépendre des vrais fichiers (WebGL/canvas 2D réels, testés
// séparément via Playwright — voir CLAUDE.md sur background-fx.js, hors périmètre vitest pour
// les mêmes raisons : rendu décoratif, pas de logique à vérifier par de l'assertion). Fusionne
// dans window.AguilaBackgrounds plutôt que de l'écraser, pour rester utilisable dans n'importe
// quel ordre d'appel entre les différents stub*().
function stubBackground(dom, id, { mountSucceeds = true } = {}) {
  const calls = { mount: 0, unmount: 0 };
  dom.window.AguilaBackgrounds = dom.window.AguilaBackgrounds || {};
  dom.window.AguilaBackgrounds[id] = {
    mount: (...args) => { calls.mount++; },
    unmount: (...args) => { calls.unmount++; },
    isActive: () => mountSucceeds,
  };
  return calls;
}
const stubGalaxy = (dom, opts) => stubBackground(dom, "galaxy", opts);
const stubClassic = (dom, opts) => stubBackground(dom, "classic", opts);

describe("theme.js — THEMES", () => {
  it("declare bien les 5 thèmes attendus, chacun avec un canvas dédié", () => {
    const dom = loadPage(["config.js", "theme.js"], { html: FIXTURE_HTML });
    const themes = getGlobal(dom, "THEMES"); // const top-level : jamais sur window, voir loadPage.js
    const ids = themes.map((t) => t.id).sort();
    expect(ids).toEqual(["aurora", "classic", "cyber", "galaxy", "minimal"]);
    themes.forEach((t) => {
      expect(t.canvasId).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.swatch).toBeTruthy();
    });
  });
});

describe("theme.js — getActiveTheme / setActiveTheme", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "theme.js"], { html: FIXTURE_HTML });
    dom.window.localStorage.clear();
  });

  it("defaults to 'galaxy' when nothing is stored yet", () => {
    expect(dom.window.getActiveTheme()).toBe("galaxy");
  });

  it("returns the stored theme once set", () => {
    dom.window.setActiveTheme("classic");
    expect(dom.window.getActiveTheme()).toBe("classic");
  });

  it("accepts any of the newer themes (aurora/cyber/minimal), not just the original two", () => {
    for (const id of ["aurora", "cyber", "minimal"]) {
      dom.window.setActiveTheme(id);
      expect(dom.window.getActiveTheme()).toBe(id);
    }
  });

  it("falls back to the default for an unrecognized stored value (e.g. a removed theme id)", () => {
    dom.window.localStorage.setItem("aguilaradar_theme", "some-old-removed-theme");
    expect(dom.window.getActiveTheme()).toBe("galaxy");
  });

  it("survives a localStorage that throws (private browsing) without crashing, using the default", () => {
    const original = dom.window.localStorage.getItem;
    dom.window.localStorage.getItem = () => { throw new Error("blocked"); };
    expect(() => dom.window.getActiveTheme()).not.toThrow();
    expect(dom.window.getActiveTheme()).toBe("galaxy");
    dom.window.localStorage.getItem = original;
  });

  it("setActiveTheme survives a throwing localStorage without crashing", () => {
    dom.window.localStorage.setItem = () => { throw new Error("blocked"); };
    expect(() => dom.window.setActiveTheme("classic")).not.toThrow();
  });
});

describe("theme.js — mountActiveBackground", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "theme.js"], { html: FIXTURE_HTML });
    dom.window.localStorage.clear();
  });

  it("mounts the galaxy canvas and hides the other canvases when the theme is 'galaxy' and mount succeeds", () => {
    const galaxy = stubGalaxy(dom, { mountSucceeds: true });
    const classic = stubClassic(dom);
    dom.window.setActiveTheme("galaxy");
    dom.window.mountActiveBackground();
    expect(dom.window.document.getElementById("bg-galaxy-canvas").hidden).toBe(false);
    expect(dom.window.document.getElementById("bg-radar-canvas").hidden).toBe(true);
    expect(dom.window.document.getElementById("bg-aurora-canvas").hidden).toBe(true);
    expect(dom.window.document.getElementById("bg-cyber-canvas").hidden).toBe(true);
    expect(dom.window.document.getElementById("bg-minimal-canvas").hidden).toBe(true);
    expect(galaxy.mount).toBe(1);
    expect(classic.mount).toBe(0);
  });

  it("falls back to Classique when the galaxy theme is selected but the mount actually fails", () => {
    stubGalaxy(dom, { mountSucceeds: false });
    const classic = stubClassic(dom, { mountSucceeds: true });
    dom.window.setActiveTheme("galaxy");
    dom.window.mountActiveBackground();
    expect(dom.window.document.getElementById("bg-galaxy-canvas").hidden).toBe(true);
    expect(dom.window.document.getElementById("bg-radar-canvas").hidden).toBe(false);
    expect(classic.mount).toBe(1);
  });

  it("falls back to Classique when window.AguilaBackgrounds.galaxy was never registered (module failed to load)", () => {
    const classic = stubClassic(dom);
    dom.window.setActiveTheme("galaxy");
    expect(() => dom.window.mountActiveBackground()).not.toThrow();
    expect(classic.mount).toBe(1);
  });

  it("never throws even when no background at all is registered", () => {
    dom.window.setActiveTheme("galaxy");
    expect(() => dom.window.mountActiveBackground()).not.toThrow();
  });

  it("goes straight to Classique (never touches the galaxy module) when the theme is 'classic'", () => {
    const galaxy = stubGalaxy(dom, { mountSucceeds: true });
    const classic = stubClassic(dom);
    dom.window.setActiveTheme("classic");
    dom.window.mountActiveBackground();
    expect(dom.window.document.getElementById("bg-radar-canvas").hidden).toBe(false);
    expect(dom.window.document.getElementById("bg-galaxy-canvas").hidden).toBe(true);
    expect(galaxy.mount).toBe(0);
    expect(classic.mount).toBe(1);
  });

  it("mounts each of the newer themes (aurora/cyber/minimal) on its own dedicated canvas", () => {
    stubClassic(dom); // filet de repli, ne doit jamais être sollicité ici
    for (const id of ["aurora", "cyber", "minimal"]) {
      const handler = stubBackground(dom, id, { mountSucceeds: true });
      dom.window.setActiveTheme(id);
      dom.window.mountActiveBackground();
      const canvasIdByTheme = { aurora: "bg-aurora-canvas", cyber: "bg-cyber-canvas", minimal: "bg-minimal-canvas" };
      expect(dom.window.document.getElementById(canvasIdByTheme[id]).hidden).toBe(false);
      expect(handler.mount).toBe(1);
    }
  });

  it("stops the running Classique background before switching to Galaxie 3D", () => {
    const galaxy = stubGalaxy(dom, { mountSucceeds: true });
    const classic = stubClassic(dom, { mountSucceeds: true });
    dom.window.setActiveTheme("classic");
    dom.window.mountActiveBackground();
    expect(classic.mount).toBe(1);
    // isActive() est un stub statique (toujours true) : unmountAllBackgrounds() appelle donc
    // déjà classic.unmount() une fois ici, avant même le changement de thème réel (même
    // remarque que pour galaxy dans le test suivant) — on vérifie l'augmentation exacte au
    // changement de thème, pas une valeur absolue avant.
    const unmountsAfterFirstMount = classic.unmount;

    dom.window.setActiveTheme("galaxy");
    dom.window.mountActiveBackground();
    expect(classic.unmount).toBe(unmountsAfterFirstMount + 1); // le fond Classique précédent a bien été arrêté
    expect(galaxy.mount).toBe(1);
  });

  it("unmounts the running Galaxie 3D background before switching to Classique", () => {
    const galaxy = stubGalaxy(dom, { mountSucceeds: true });
    stubClassic(dom, { mountSucceeds: true });
    dom.window.setActiveTheme("galaxy");
    dom.window.mountActiveBackground();
    // unmountAllBackgrounds() appelle .unmount() sur chaque fond dont isActive() renvoie true à
    // CHAQUE mountActiveBackground() (y compris ce premier appel, puisque isActive() est un stub
    // statique ici) — on vérifie donc l'augmentation exacte d'un appel au changement de thème,
    // pas une valeur absolue avant.
    const before = galaxy.unmount;

    dom.window.setActiveTheme("classic");
    dom.window.mountActiveBackground();
    expect(galaxy.unmount).toBe(before + 1);
  });
});

describe("theme.js — panneau de réglages (liste des thèmes)", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "theme.js"], { html: FIXTURE_HTML });
    dom.window.localStorage.clear();
    stubGalaxy(dom, { mountSucceeds: true });
    stubClassic(dom, { mountSucceeds: true });
    stubBackground(dom, "aurora", { mountSucceeds: true });
    stubBackground(dom, "cyber", { mountSucceeds: true });
    stubBackground(dom, "minimal", { mountSucceeds: true });
  });

  it("renders exactly one card per thème disponible (5 désormais)", () => {
    dom.window.renderThemeList();
    expect(dom.window.document.querySelectorAll(".design-theme-card")).toHaveLength(5);
  });

  it("marks the currently active theme's card, and only that one", () => {
    dom.window.setActiveTheme("classic");
    dom.window.renderThemeList();
    const cards = dom.window.document.querySelectorAll(".design-theme-card");
    const active = Array.from(cards).filter((c) => c.classList.contains("active"));
    expect(active).toHaveLength(1);
    expect(active[0].dataset.themeId).toBe("classic");
    expect(active[0].querySelector(".design-theme-check").textContent).toContain("Actif");
  });

  it("clicking a different theme's card switches the background and re-renders the active state", () => {
    dom.window.setActiveTheme("classic");
    dom.window.renderThemeList();
    const galaxyCard = dom.window.document.querySelector('.design-theme-card[data-theme-id="galaxy"]');
    galaxyCard.click();
    expect(dom.window.getActiveTheme()).toBe("galaxy");
    expect(dom.window.document.querySelector('.design-theme-card[data-theme-id="galaxy"]').classList.contains("active")).toBe(true);
    expect(dom.window.document.getElementById("bg-galaxy-canvas").hidden).toBe(false);
  });

  it("clicking the already-active theme's card is a no-op (no redundant remount)", () => {
    const galaxy = stubGalaxy(dom, { mountSucceeds: true });
    dom.window.setActiveTheme("galaxy");
    dom.window.renderThemeList();
    dom.window.document.querySelector('.design-theme-card[data-theme-id="galaxy"]').click();
    expect(galaxy.mount).toBe(0);
  });

  it("clicking a newer theme's card (aurora) switches to it just like the original two", () => {
    dom.window.setActiveTheme("classic");
    dom.window.renderThemeList();
    dom.window.document.querySelector('.design-theme-card[data-theme-id="aurora"]').click();
    expect(dom.window.getActiveTheme()).toBe("aurora");
    expect(dom.window.document.getElementById("bg-aurora-canvas").hidden).toBe(false);
  });
});

describe("theme.js — initThemeSwitcher (ouverture/fermeture du panneau)", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "theme.js"], { html: FIXTURE_HTML });
    dom.window.localStorage.clear();
    stubGalaxy(dom, { mountSucceeds: true });
    stubClassic(dom, { mountSucceeds: true });
    dom.window.initThemeSwitcher();
  });

  it("opens the panel and populates the theme list when the settings button is clicked", () => {
    dom.window.document.getElementById("design-settings-btn").click();
    expect(dom.window.document.getElementById("design-settings-panel").hidden).toBe(false);
    expect(dom.window.document.querySelectorAll(".design-theme-card").length).toBeGreaterThan(0);
  });

  it("closes the panel when the close button is clicked", () => {
    dom.window.document.getElementById("design-settings-btn").click();
    dom.window.document.getElementById("design-settings-close").click();
    expect(dom.window.document.getElementById("design-settings-panel").hidden).toBe(true);
  });

  it("closes the panel when the backdrop is clicked", () => {
    dom.window.document.getElementById("design-settings-btn").click();
    dom.window.document.querySelector(".design-settings-backdrop").click();
    expect(dom.window.document.getElementById("design-settings-panel").hidden).toBe(true);
  });

  it("closes the panel on Escape, only while it is open", () => {
    const escEvent = () => new dom.window.KeyboardEvent("keydown", { key: "Escape" });
    dom.window.document.dispatchEvent(escEvent());
    expect(dom.window.document.getElementById("design-settings-panel").hidden).toBe(true); // deja ferme, pas d'erreur

    dom.window.document.getElementById("design-settings-btn").click();
    dom.window.document.dispatchEvent(escEvent());
    expect(dom.window.document.getElementById("design-settings-panel").hidden).toBe(true);
  });
});

// reloadWithCacheBust() elle-meme (vraie navigation) n'est pas testable sous jsdom (verifie
// empiriquement : location.replace() y leve "Not implemented: navigation", meme quand on essaie
// de la remplacer — jsdom n'expose pas location.replace comme reassignable). On la stubbe donc
// via runScript, exactement comme sha256Hex dans auth.test.js (fonction top-level, pas une
// valeur JSON) pour ne verifier que le CABLAGE du bouton ; la vraie navigation est du ressort de
// Playwright, pas de vitest — meme logique que les fonds decoratifs de background-fx.js.
describe("theme.js — initCacheClearButton", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "theme.js"], { html: FIXTURE_HTML });
    runScript(dom, "reloadWithCacheBust = () => { window.__reloadCalls = (window.__reloadCalls || 0) + 1; };", "stub reloadWithCacheBust");
    dom.window.initCacheClearButton();
  });

  it("calls reloadWithCacheBust exactly once when clicked", () => {
    dom.window.document.getElementById("clear-cache-btn").click();
    expect(dom.window.__reloadCalls).toBe(1);
  });

  it("disables the button and updates its label immediately on click", () => {
    const btn = dom.window.document.getElementById("clear-cache-btn");
    btn.click();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("Rechargement");
  });

  it("does not throw when the button is missing from the page", () => {
    const bareDom = loadPage(["config.js", "theme.js"], { html: "<!doctype html><html><body></body></html>" });
    expect(() => bareDom.window.initCacheClearButton()).not.toThrow();
  });
});
