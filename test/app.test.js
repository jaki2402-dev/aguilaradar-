import { describe, it, expect, beforeEach } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

// updateFreshnessIndicator ne dépend de "maintenant" que via Date.now() (les new Date(t)
// du code, eux, reçoivent toujours un argument et gardent leur vrai comportement). Note :
// vi.useFakeTimers() de Vitest ne suffit pas ici — il patche le Date du realm Node ambiant,
// pas le Date du contexte JSDOM séparé créé par loadPage (vérifié). On fige donc
// directement window.Date.now sur la page chargée.
function freezeNow(dom, iso) {
  const fixed = new Date(iso).getTime();
  dom.window.Date.now = () => fixed;
  return fixed;
}

describe("app.js — updateFreshnessIndicator (régression 4d520ad)", () => {
  const NOW_ISO = "2026-08-17T12:00:00Z";
  let dom, el;

  beforeEach(() => {
    dom = loadPage(["app.js"], { html: `<!doctype html><html><body><div id="last-deep-cycle"></div></body></html>` });
    freezeNow(dom, NOW_ISO);
    el = dom.window.document.getElementById("last-deep-cycle");
  });

  it("shows the 'not configured' message when neither timestamp is present", () => {
    dom.window.updateFreshnessIndicator({}, {});
    expect(el.textContent).toBe("Automatisation pas encore activée — routine programmée à configurer.");
    expect(el.className).toBe("");
  });

  it("reads routine_health.last_success_at, updated on every successful deep cycle regardless of whether anything changed", () => {
    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T11:00:00Z" } }, {});
    expect(el.classList.contains("freshness-ok")).toBe(true);
  });

  it("falls back to opportunities.last_scan_at when routine_health is absent", () => {
    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-17T11:00:00Z" });
    expect(el.classList.contains("freshness-ok")).toBe(true);
  });

  it("régression 4d520ad — with both timestamps present, uses whichever is MORE RECENT, not routine_health unconditionally nor global_stats", () => {
    // routine_health à 1h (frais) mais opportunities à 10h (obsolète si utilisé seul) :
    // avant le correctif, lire le mauvais champ pouvait figer l'indicateur sur "obsolète"
    // pendant des heures sur un cycle pourtant réussi. Le bon comportement est de prendre
    // le plus récent des deux, jamais un champ fixe.
    dom.window.updateFreshnessIndicator(
      { routine_health: { last_success_at: "2026-08-17T11:00:00Z" } }, // 1h
      { last_scan_at: "2026-08-17T02:00:00Z" } // 10h — serait "stale" si utilisé seul
    );
    expect(el.classList.contains("freshness-ok")).toBe(true);
    expect(el.classList.contains("freshness-stale")).toBe(false);
  });

  it("does not read engineHistory.global_stats.last_computed_at at all (that was the actual bug: it stays stale across cycles that resolved nothing)", () => {
    dom.window.updateFreshnessIndicator(
      { global_stats: { last_computed_at: "2026-08-17T11:59:00Z" } }, // tres frais mais ne doit pas etre lu
      {}
    );
    // Aucun timestamp reconnu (routine_health/opportunities absents) -> message "pas configuree",
    // meme si global_stats.last_computed_at est tres recent.
    expect(el.textContent).toBe("Automatisation pas encore activée — routine programmée à configurer.");
  });

  it("is 'ok' at exactly 3 hours and 'warning' just past it", () => {
    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T09:00:00Z" } }, {});
    expect(el.classList.contains("freshness-ok")).toBe(true);

    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T08:59:00Z" } }, {});
    expect(el.classList.contains("freshness-warning")).toBe(true);
  });

  it("is 'warning' at exactly 6 hours and 'stale' (with a warning glyph) just past it", () => {
    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T06:00:00Z" } }, {});
    expect(el.classList.contains("freshness-warning")).toBe(true);

    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T05:59:00Z" } }, {});
    expect(el.classList.contains("freshness-stale")).toBe(true);
    expect(el.textContent).toContain("⚠");
    expect(el.textContent).toContain("routine semble bloquée");
  });
});
