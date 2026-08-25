import { describe, it, expect, beforeEach } from "vitest";
import { loadPage, setGlobal } from "./helpers/loadPage.js";

const PORTFOLIO_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="portfolio-totals"></div>
  <div id="portfolio-body"></div>
</body></html>`;

function pos(overrides) {
  return { cgId: "bitcoin", qty: 1, invested: 100, ...overrides };
}

describe("portfolio.js — renderPortfolio", () => {
  let dom;

  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "portfolio.js"], { html: PORTFOLIO_FIXTURE_HTML });
  });

  it("computes value, P&L (€) and P&L (%) from the live price against the fixed invested capital", () => {
    setGlobal(dom, "latestFavorisPrices", { bitcoin: { eur: 100 } });
    dom.window.renderPortfolio({ positions: [pos({ qty: 3, invested: 100 })] }, []);
    const body = dom.window.document.getElementById("portfolio-body").textContent;
    expect(body).toContain("300,00"); // valeur = 3 * 100
    expect(body).toContain("100,00"); // investi, inchangé
    expect(body).toContain("+200,00"); // P&L = 300 - 100
    expect(body).toContain("200.00"); // P&L % = 200/100*100
  });

  it("renders a loss with a single leading minus sign (Math.abs + explicit sign, no double negative)", () => {
    setGlobal(dom, "latestFavorisPrices", { bitcoin: { eur: 60 } });
    dom.window.renderPortfolio({ positions: [pos({ qty: 2, invested: 300 })] }, []);
    const body = dom.window.document.getElementById("portfolio-body").textContent;
    // valeur = 120, investi = 300, P&L = -180 (-60 %)
    expect(body).toContain("-180,00");
    expect(body).toContain("-60.00");
    expect(body).not.toContain("--");
  });

  it("shows '—' for value/P&L and excludes the position from totals when no live price is available for it", () => {
    setGlobal(dom, "latestFavorisPrices", {});
    dom.window.renderPortfolio({ positions: [pos({ qty: 10, invested: 500 })] }, []);
    const bodyEl = dom.window.document.getElementById("portfolio-body");
    expect(bodyEl.textContent).toContain("—");
    expect(bodyEl.textContent).toContain("500,00"); // investi reste affiché même sans prix live
    const totals = dom.window.document.getElementById("portfolio-totals").textContent;
    expect(totals).toContain("0,00"); // mais exclue des totaux (pas de valeur calculable)
  });

  it("shows a pending row (qty/invested null) without inventing numbers, and excludes it from totals", () => {
    setGlobal(dom, "latestFavorisPrices", { bitcoin: { eur: 100 } });
    dom.window.renderPortfolio(
      {
        positions: [pos({ qty: 3, invested: 100 }), { cgId: "zelcash", qty: null, invested: null, pending: true }],
      },
      []
    );
    const bodyEl = dom.window.document.getElementById("portfolio-body");
    expect(bodyEl.textContent).toContain("En attente");
    const totals = dom.window.document.getElementById("portfolio-totals").textContent;
    expect(totals).toContain("300,00"); // seule la position bitcoin compte dans le total
  });

  it("aggregates value/invested/P&L across multiple positions into the totals block", () => {
    setGlobal(dom, "latestFavorisPrices", { bitcoin: { eur: 100 }, ethereum: { eur: 5 } });
    dom.window.renderPortfolio(
      {
        positions: [pos({ cgId: "bitcoin", qty: 3, invested: 150 }), pos({ cgId: "ethereum", qty: 20, invested: 20 })],
      },
      []
    );
    const totals = dom.window.document.getElementById("portfolio-totals").textContent;
    // valeur = 300 + 100 = 400, investi = 150 + 20 = 170, P&L = +230 (135.29 %)
    expect(totals).toContain("400,00");
    expect(totals).toContain("170,00");
    expect(totals).toContain("+230,00");
    expect(totals).toContain("135.29");
  });

  it("shows the badge of the most recent verdict (by issued_at) for that asset as advice", () => {
    setGlobal(dom, "latestFavorisPrices", { bitcoin: { eur: 100 } });
    const verdicts = [
      { asset: "bitcoin", verdict: "ACHAT", issued_at: "2026-08-01T00:00:00Z", reasoning: "ancien" },
      { asset: "bitcoin", verdict: "VENTE", issued_at: "2026-08-20T00:00:00Z", reasoning: "récent" },
    ];
    dom.window.renderPortfolio({ positions: [pos({ qty: 1, invested: 50 })] }, verdicts);
    const bodyEl = dom.window.document.getElementById("portfolio-body");
    expect(bodyEl.querySelector(".badge-vente")).not.toBeNull();
    expect(bodyEl.querySelector(".badge-achat")).toBeNull();
  });

  it("shows no advice badge when no verdict exists yet for that asset", () => {
    setGlobal(dom, "latestFavorisPrices", { bitcoin: { eur: 100 } });
    dom.window.renderPortfolio({ positions: [pos({ qty: 1, invested: 50 })] }, []);
    const bodyEl = dom.window.document.getElementById("portfolio-body");
    expect(bodyEl.querySelector(".badge-achat, .badge-vente, .badge-attente")).toBeNull();
  });

  it("escapes verdict reasoning before using it as the advice tooltip (no attribute breakout)", () => {
    setGlobal(dom, "latestFavorisPrices", { bitcoin: { eur: 100 } });
    // Tente de casser l'attribut title="..." (guillemet fermant) pour injecter un vrai <img> —
    // seul un escapeHtml correct sur le guillemet neutralise ça.
    const payload = '"><img src=x onerror=alert(1)>';
    const verdicts = [{ asset: "bitcoin", verdict: "ACHAT", issued_at: "2026-08-20T00:00:00Z", reasoning: payload }];
    dom.window.renderPortfolio({ positions: [pos({ qty: 1, invested: 50 })] }, verdicts);
    const bodyEl = dom.window.document.getElementById("portfolio-body");
    expect(bodyEl.querySelector("img")).toBeNull();
    expect(bodyEl.querySelector(".badge-achat").getAttribute("title")).toBe(payload);
  });

  it("shows an empty-state message when there are no positions", () => {
    dom.window.renderPortfolio({ positions: [] }, []);
    expect(dom.window.document.getElementById("portfolio-body").textContent).toContain("pas encore configuré");
  });

  it("does not throw when called with null portfolio/verdicts, and falls back to the empty state", () => {
    expect(() => dom.window.renderPortfolio(null, null)).not.toThrow();
    expect(dom.window.document.getElementById("portfolio-body").textContent).toContain("pas encore configuré");
  });

  it("recomputes value/P&L from cached positions when called with no arguments (price-tick refresh)", () => {
    setGlobal(dom, "latestFavorisPrices", { bitcoin: { eur: 100 } });
    dom.window.renderPortfolio({ positions: [pos({ qty: 2, invested: 100 })] }, []);
    expect(dom.window.document.getElementById("portfolio-body").textContent).toContain("200,00");

    setGlobal(dom, "latestFavorisPrices", { bitcoin: { eur: 200 } });
    dom.window.renderPortfolio();
    expect(dom.window.document.getElementById("portfolio-body").textContent).toContain("400,00");
  });
});
