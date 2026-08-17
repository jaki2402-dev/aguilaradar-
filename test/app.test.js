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

describe("app.js — updateFreshnessIndicator (régression 4d520ad, puis régression du 17/08 sur les cadences par source)", () => {
  const NOW_ISO = "2026-08-17T12:00:00Z";
  let dom, el;

  beforeEach(() => {
    dom = loadPage(["app.js"], { html: `<!doctype html><html><body><div id="last-deep-cycle"></div></body></html>` });
    freezeNow(dom, NOW_ISO);
    el = dom.window.document.getElementById("last-deep-cycle");
  });

  it("shows the 'not configured' message when no source has a timestamp", () => {
    dom.window.updateFreshnessIndicator({}, {}, {});
    expect(el.textContent).toBe("Automatisation pas encore activée — routine programmée à configurer.");
    expect(el.className).toBe("");
  });

  it("reads routine_health.last_success_at, updated on every successful deep cycle regardless of whether anything changed", () => {
    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T11:00:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-ok")).toBe(true);
  });

  it("reads opportunities.last_scan_at on its own weekly-cadence thresholds when it is the only source present", () => {
    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-17T11:00:00Z" }, {}); // 1h — trivialement frais pour un rythme hebdomadaire
    expect(el.classList.contains("freshness-ok")).toBe(true);
    expect(el.textContent).toContain("Criblage opportunités");
  });

  it("reads news.last_updated_at when it is the only source present", () => {
    dom.window.updateFreshnessIndicator({}, {}, { last_updated_at: "2026-08-17T11:00:00Z" }); // 1h
    expect(el.classList.contains("freshness-ok")).toBe(true);
    expect(el.textContent).toContain("Actualités");
  });

  it("régression du 17/08 — un routine_health frais ne doit plus masquer une veille actualités obsolète sur son propre rythme ~2h", () => {
    // Cas réel du 17/08 : cycle macro/verdicts frais (tourne toutes les 2h) pendant que la
    // veille actualités n'avait rien écrit depuis 8h. Avant ce correctif, prendre le
    // timestamp le plus récent des sources affichait "à jour" et masquait le blocage.
    dom.window.updateFreshnessIndicator(
      { routine_health: { last_success_at: "2026-08-17T11:00:00Z" } }, // 1h — frais
      {},
      { last_updated_at: "2026-08-17T04:00:00Z" } // 8h — obsolète pour une source ~2h
    );
    expect(el.classList.contains("freshness-stale")).toBe(true);
    expect(el.textContent).toContain("Actualités");
    expect(el.textContent).toContain("⚠");
  });

  it("régression du 17/08 — un routine_health frais ne doit plus masquer un criblage d'opportunités obsolète sur son propre rythme hebdomadaire", () => {
    // Cas réel du 17/08 : opportunities.last_scan_at figé depuis le 07/08 (criblage repris
    // par une routine hebdomadaire dédiée) pendant que routine_health continuait de tourner
    // toutes les 2h — l'ancien indicateur (timestamp le plus récent des deux) affichait
    // "à jour" en continu pendant des jours.
    dom.window.updateFreshnessIndicator(
      { routine_health: { last_success_at: "2026-08-17T11:00:00Z" } }, // 1h — frais
      { last_scan_at: "2026-08-06T12:00:00Z" }, // 11 jours — obsolète pour une cadence hebdomadaire
      {}
    );
    expect(el.classList.contains("freshness-stale")).toBe(true);
    expect(el.textContent).toContain("Criblage opportunités");
    expect(el.textContent).toContain("j");
  });

  it("does not read engineHistory.global_stats.last_computed_at at all (that was the original bug: it stays stale across cycles that resolved nothing)", () => {
    dom.window.updateFreshnessIndicator(
      { global_stats: { last_computed_at: "2026-08-17T11:59:00Z" } }, // tres frais mais ne doit pas etre lu
      {},
      {}
    );
    // Aucun timestamp reconnu (routine_health/opportunities/news absents) -> message "pas
    // configuree", meme si global_stats.last_computed_at est tres recent.
    expect(el.textContent).toBe("Automatisation pas encore activée — routine programmée à configurer.");
  });

  it("routine_health : 'ok' at exactly 3 hours, 'warning' just past it", () => {
    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T09:00:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-ok")).toBe(true);

    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T08:59:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-warning")).toBe(true);
  });

  it("routine_health : 'warning' at exactly 6 hours, 'stale' (with a warning glyph) just past it", () => {
    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T06:00:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-warning")).toBe(true);

    dom.window.updateFreshnessIndicator({ routine_health: { last_success_at: "2026-08-17T05:59:00Z" } }, {}, {});
    expect(el.classList.contains("freshness-stale")).toBe(true);
    expect(el.textContent).toContain("⚠");
    expect(el.textContent).toContain("routine semble bloquée");
  });

  it("opportunities : 'ok' up to 8 days, 'warning' between 8 and 10 days, 'stale' past 10 days", () => {
    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-09T12:00:00Z" }, {}); // 8j pile
    expect(el.classList.contains("freshness-ok")).toBe(true);

    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-09T11:00:00Z" }, {}); // 8j + 1h
    expect(el.classList.contains("freshness-warning")).toBe(true);

    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-07T13:00:00Z" }, {}); // 9j23h
    expect(el.classList.contains("freshness-warning")).toBe(true);

    dom.window.updateFreshnessIndicator({}, { last_scan_at: "2026-08-07T11:00:00Z" }, {}); // 10j1h
    expect(el.classList.contains("freshness-stale")).toBe(true);
  });

  it("shows the single worst source when several are degraded, ranked stale > warning > ok", () => {
    dom.window.updateFreshnessIndicator(
      { routine_health: { last_success_at: "2026-08-17T08:00:00Z" } }, // 4h — warning
      { last_scan_at: "2026-08-07T00:00:00Z" }, // 10j12h — stale
      { last_updated_at: "2026-08-17T11:00:00Z" } // 1h — ok
    );
    expect(el.classList.contains("freshness-stale")).toBe(true);
    expect(el.textContent).toContain("Criblage opportunités");
  });
});
