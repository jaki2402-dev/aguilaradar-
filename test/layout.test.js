import { describe, it, expect, beforeEach } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

const FIXTURE_HTML = `<!doctype html><html><body>
  <div id="favoris-grid" class="favoris-grid"></div>
  <div id="design-layout-list"></div>
</body></html>`;

describe("layout.js — getActiveLayout / setActiveLayout", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "layout.js"], { html: FIXTURE_HTML });
    dom.window.localStorage.clear();
  });

  it("defaults to 'dense' when nothing is stored yet", () => {
    expect(dom.window.getActiveLayout()).toBe("dense");
  });

  it("returns the stored layout once set", () => {
    dom.window.setActiveLayout("list");
    expect(dom.window.getActiveLayout()).toBe("list");
  });

  it("falls back to the default for an unrecognized stored value (e.g. a removed layout id)", () => {
    dom.window.localStorage.setItem("aguilaradar_favoris_layout", "some-old-removed-layout");
    expect(dom.window.getActiveLayout()).toBe("dense");
  });

  it("survives a localStorage that throws (private browsing) without crashing, using the default", () => {
    const original = dom.window.localStorage.getItem;
    dom.window.localStorage.getItem = () => { throw new Error("blocked"); };
    expect(() => dom.window.getActiveLayout()).not.toThrow();
    expect(dom.window.getActiveLayout()).toBe("dense");
    dom.window.localStorage.getItem = original;
  });

  it("setActiveLayout survives a throwing localStorage without crashing", () => {
    dom.window.localStorage.setItem = () => { throw new Error("blocked"); };
    expect(() => dom.window.setActiveLayout("list")).not.toThrow();
  });
});

describe("layout.js — applyFavorisLayout", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "layout.js"], { html: FIXTURE_HTML });
    dom.window.localStorage.clear();
  });

  it("adds the layout-<id> class to #favoris-grid", () => {
    dom.window.applyFavorisLayout("comfort");
    expect(dom.window.document.getElementById("favoris-grid").classList.contains("layout-comfort")).toBe(true);
  });

  it("removes any previously applied layout class before adding the new one", () => {
    dom.window.applyFavorisLayout("list");
    dom.window.applyFavorisLayout("comfort");
    const classes = dom.window.document.getElementById("favoris-grid").classList;
    expect(classes.contains("layout-list")).toBe(false);
    expect(classes.contains("layout-comfort")).toBe(true);
  });

  it("never throws when #favoris-grid does not exist in the DOM", () => {
    dom.window.document.getElementById("favoris-grid").remove();
    expect(() => dom.window.applyFavorisLayout("list")).not.toThrow();
  });

  it("survives a page refresh's innerHTML rewrite (class lives on the grid, not its children)", () => {
    dom.window.applyFavorisLayout("comfort");
    dom.window.document.getElementById("favoris-grid").innerHTML = "<div>nouveau contenu</div>";
    expect(dom.window.document.getElementById("favoris-grid").classList.contains("layout-comfort")).toBe(true);
  });
});

describe("layout.js — panneau de réglages (liste des dispositions)", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "layout.js"], { html: FIXTURE_HTML });
    dom.window.localStorage.clear();
  });

  it("renders exactly one card per disposition disponible", () => {
    dom.window.renderLayoutList();
    expect(dom.window.document.querySelectorAll(".design-layout-card")).toHaveLength(3);
  });

  it("marks the currently active layout's card, and only that one", () => {
    dom.window.setActiveLayout("list");
    dom.window.renderLayoutList();
    const cards = dom.window.document.querySelectorAll(".design-layout-card");
    const active = Array.from(cards).filter((c) => c.classList.contains("active"));
    expect(active).toHaveLength(1);
    expect(active[0].dataset.layoutId).toBe("list");
    expect(active[0].querySelector(".design-theme-check").textContent).toContain("Actif");
  });

  it("clicking a different layout's card switches the grid class and re-renders the active state", () => {
    dom.window.renderLayoutList();
    const comfortCard = dom.window.document.querySelector('.design-layout-card[data-layout-id="comfort"]');
    comfortCard.click();
    expect(dom.window.getActiveLayout()).toBe("comfort");
    expect(dom.window.document.querySelector('.design-layout-card[data-layout-id="comfort"]').classList.contains("active")).toBe(true);
    expect(dom.window.document.getElementById("favoris-grid").classList.contains("layout-comfort")).toBe(true);
  });

  it("clicking the already-active layout's card is a no-op (no redundant class churn)", () => {
    dom.window.initLayoutSwitcher(); // applique la disposition initiale, comme au vrai chargement
    const grid = dom.window.document.getElementById("favoris-grid");
    dom.window.document.querySelector('.design-layout-card[data-layout-id="dense"]').click();
    expect(grid.classList.contains("layout-dense")).toBe(true);
    const layoutClasses = Array.from(grid.classList).filter((c) => c.startsWith("layout-"));
    expect(layoutClasses).toEqual(["layout-dense"]); // pas de classe layout-* superflue ajoutée en double
  });
});

describe("layout.js — initLayoutSwitcher", () => {
  let dom;
  beforeEach(() => {
    dom = loadPage(["config.js", "layout.js"], { html: FIXTURE_HTML });
    dom.window.localStorage.clear();
  });

  it("applies the stored layout to the grid immediately, without waiting for the settings panel to open", () => {
    dom.window.setActiveLayout("comfort");
    dom.window.initLayoutSwitcher();
    expect(dom.window.document.getElementById("favoris-grid").classList.contains("layout-comfort")).toBe(true);
  });

  it("pre-populates the settings list so it's ready the moment the panel opens", () => {
    dom.window.initLayoutSwitcher();
    expect(dom.window.document.querySelectorAll(".design-layout-card").length).toBe(3);
  });
});
