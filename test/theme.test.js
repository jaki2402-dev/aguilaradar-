import { describe, it, expect, beforeEach } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

const FIXTURE_HTML = `<!doctype html><html><body>
  <canvas id="bg-radar-canvas"></canvas>
  <canvas id="bg-galaxy-canvas" hidden></canvas>
  <button id="design-settings-btn"></button>
  <div id="design-settings-panel" hidden>
    <div class="design-settings-backdrop"></div>
    <div class="design-settings-card">
      <button id="design-settings-close"></button>
      <div class="design-theme-list" id="design-theme-list"></div>
    </div>
  </div>
</body></html>`;

// Simule bg-galaxy-3d.js sans dépendre du vrai module (WebGL réel, testé séparément via
// Playwright — voir CLAUDE.md sur background-fx.js, hors périmètre vitest pour les mêmes
// raisons : rendu décoratif, pas de logique à vérifier par de l'assertion).
function stubGalaxy(dom, { mountSucceeds = true } = {}) {
  const mount = () => {};
  const unmount = () => {};
  const calls = { mount: 0, unmount: 0 };
  dom.window.AguilaBackgrounds = {
    galaxy: {
      mount: (...args) => { calls.mount++; mount(...args); },
      unmount: (...args) => { calls.unmount++; unmount(...args); },
      isActive: () => mountSucceeds,
    },
  };
  return calls;
}

function stubRadar(dom) {
  const calls = { init: 0, stop: 0 };
  dom.window.initRadarBackground = () => {
    calls.init++;
    return { stop: () => calls.stop++ };
  };
  return calls;
}

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

  it("mounts the galaxy canvas and hides the radar canvas when the theme is 'galaxy' and WebGL mount succeeds", () => {
    const galaxy = stubGalaxy(dom, { mountSucceeds: true });
    const radar = stubRadar(dom);
    dom.window.setActiveTheme("galaxy");
    dom.window.mountActiveBackground();
    expect(dom.window.document.getElementById("bg-galaxy-canvas").hidden).toBe(false);
    expect(dom.window.document.getElementById("bg-radar-canvas").hidden).toBe(true);
    expect(galaxy.mount).toBe(1);
    expect(radar.init).toBe(0);
  });

  it("falls back to Classique when the galaxy theme is selected but the WebGL mount actually fails", () => {
    stubGalaxy(dom, { mountSucceeds: false });
    const radar = stubRadar(dom);
    dom.window.setActiveTheme("galaxy");
    dom.window.mountActiveBackground();
    expect(dom.window.document.getElementById("bg-galaxy-canvas").hidden).toBe(true);
    expect(dom.window.document.getElementById("bg-radar-canvas").hidden).toBe(false);
    expect(radar.init).toBe(1);
  });

  it("falls back to Classique when window.AguilaBackgrounds.galaxy was never registered (module failed to load)", () => {
    const radar = stubRadar(dom);
    dom.window.setActiveTheme("galaxy");
    expect(() => dom.window.mountActiveBackground()).not.toThrow();
    expect(radar.init).toBe(1);
  });

  it("never throws even when neither background is available at all", () => {
    dom.window.setActiveTheme("galaxy");
    expect(() => dom.window.mountActiveBackground()).not.toThrow();
  });

  it("goes straight to Classique (never touches the galaxy module) when the theme is 'classic'", () => {
    const galaxy = stubGalaxy(dom, { mountSucceeds: true });
    const radar = stubRadar(dom);
    dom.window.setActiveTheme("classic");
    dom.window.mountActiveBackground();
    expect(dom.window.document.getElementById("bg-radar-canvas").hidden).toBe(false);
    expect(dom.window.document.getElementById("bg-galaxy-canvas").hidden).toBe(true);
    expect(galaxy.mount).toBe(0);
    expect(radar.init).toBe(1);
  });

  it("stops the running Classique background before switching to Galaxie 3D", () => {
    const galaxy = stubGalaxy(dom, { mountSucceeds: true });
    const radar = stubRadar(dom);
    dom.window.setActiveTheme("classic");
    dom.window.mountActiveBackground();
    expect(radar.init).toBe(1);
    expect(radar.stop).toBe(0);

    dom.window.setActiveTheme("galaxy");
    dom.window.mountActiveBackground();
    expect(radar.stop).toBe(1); // le fond Classique précédent a bien été arrêté
    expect(galaxy.mount).toBe(1);
  });

  it("unmounts the running Galaxie 3D background before switching to Classique", () => {
    const galaxy = stubGalaxy(dom, { mountSucceeds: true });
    stubRadar(dom);
    dom.window.setActiveTheme("galaxy");
    dom.window.mountActiveBackground();
    // unmountAllBackgrounds() appelle galaxy.unmount() de façon défensive à CHAQUE
    // mountActiveBackground() (y compris ce premier appel) — sans effet de bord réel, puisque
    // le vrai unmount() de bg-galaxy-3d.js est un no-op si rien n'est actif. On vérifie donc
    // l'augmentation exacte d'un appel au changement de thème, pas une valeur absolue avant.
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
    stubRadar(dom);
  });

  it("renders exactly one card per thème disponible", () => {
    dom.window.renderThemeList();
    expect(dom.window.document.querySelectorAll(".design-theme-card")).toHaveLength(2);
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
});

describe("theme.js — initThemeSwitcher (ouverture/fermeture du panneau)", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "theme.js"], { html: FIXTURE_HTML });
    dom.window.localStorage.clear();
    stubGalaxy(dom, { mountSucceeds: true });
    stubRadar(dom);
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
