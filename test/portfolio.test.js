import { describe, it, expect, beforeEach } from "vitest";
import { loadPage, setGlobal } from "./helpers/loadPage.js";

const PORTFOLIO_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="portfolio-totals"></div>
  <div id="portfolio-body"></div>
  <select id="tx-asset"></select>
  <select id="tx-type">
    <option value="achat">Achat</option>
    <option value="vente">Vente</option>
  </select>
  <input id="tx-price" type="number" />
  <input id="tx-qty" type="number" />
  <button id="tx-calc-btn" type="button">Calculer</button>
  <div id="tx-result"></div>
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

describe("portfolio.js — computeTransactionResult (calculette achat/vente, coût moyen pondéré)", () => {
  const dom = loadPage(["config.js", "prices.js", "portfolio.js"]);
  const { computeTransactionResult } = dom.window;

  it("achat : ajoute la quantité et le coût à une position existante", () => {
    expect(computeTransactionResult(2, 100, "achat", 60, 1)).toEqual({ newQty: 3, newInvested: 160 });
  });

  it("achat : fonctionne depuis zéro (premier achat sur une position)", () => {
    expect(computeTransactionResult(0, 0, "achat", 50, 2)).toEqual({ newQty: 2, newInvested: 100 });
  });

  it("vente : retire le coût moyen (pas le prix de vente) de la part vendue", () => {
    // coût moyen = 100/10 = 10 par unité ; vendre 4 -> investi -= 4*10 = 40
    expect(computeTransactionResult(10, 100, "vente", 999, 4)).toEqual({ newQty: 6, newInvested: 60 });
  });

  it("vente : tout vendre ramène qty et investi à zéro", () => {
    expect(computeTransactionResult(5, 250, "vente", 40, 5)).toEqual({ newQty: 0, newInvested: 0 });
  });

  it("vente : refuse de vendre plus que la position actuelle", () => {
    const result = computeTransactionResult(3, 90, "vente", 40, 5);
    expect(result.error).toMatch(/position actuelle/);
    expect(result.newQty).toBeUndefined();
  });

  it("vente : refuse quand il n'y a aucune position actuelle", () => {
    const result = computeTransactionResult(0, 0, "vente", 40, 1);
    expect(result.error).toMatch(/Aucune position/);
  });

  it("refuse un prix non strictement positif", () => {
    expect(computeTransactionResult(2, 100, "achat", 0, 1).error).toBeDefined();
    expect(computeTransactionResult(2, 100, "achat", -5, 1).error).toBeDefined();
  });

  it("refuse une quantité non strictement positive", () => {
    expect(computeTransactionResult(2, 100, "achat", 10, 0).error).toBeDefined();
  });
});

describe("portfolio.js — renderTransactionCalculator", () => {
  let dom;

  beforeEach(() => {
    dom = loadPage(["config.js", "prices.js", "portfolio.js"], { html: PORTFOLIO_FIXTURE_HTML });
  });

  it("peuple le menu déroulant avec les 15 favoris", () => {
    dom.window.renderTransactionCalculator();
    const options = dom.window.document.querySelectorAll("#tx-asset option");
    expect(options.length).toBe(15);
    expect(Array.from(options).some((o) => o.value === "bitcoin" && o.textContent.includes("BTC"))).toBe(true);
  });

  it("calcule et affiche le nouveau qty/investi pour un achat, à partir de la position déjà chargée", () => {
    dom.window.renderPortfolio({ positions: [pos({ cgId: "bitcoin", qty: 2, invested: 200 })] }, []);
    dom.window.renderTransactionCalculator();

    dom.window.document.getElementById("tx-asset").value = "bitcoin";
    dom.window.document.getElementById("tx-type").value = "achat";
    dom.window.document.getElementById("tx-price").value = "100";
    dom.window.document.getElementById("tx-qty").value = "1";
    dom.window.document.getElementById("tx-calc-btn").click();

    const text = dom.window.document.getElementById("tx-result").textContent;
    expect(text).toContain("300,00");
    expect(text).toContain('"qty": 3');
    expect(text).toContain('"invested": 300');
  });

  it("calcule un premier achat quand l'actif n'a encore aucune position enregistrée", () => {
    dom.window.renderPortfolio({ positions: [] }, []);
    dom.window.renderTransactionCalculator();

    dom.window.document.getElementById("tx-asset").value = "ethereum";
    dom.window.document.getElementById("tx-type").value = "achat";
    dom.window.document.getElementById("tx-price").value = "200";
    dom.window.document.getElementById("tx-qty").value = "1";
    dom.window.document.getElementById("tx-calc-btn").click();

    expect(dom.window.document.getElementById("tx-result").textContent).toContain('"qty": 1');
  });

  it("affiche une erreur claire au lieu de calculer une vente impossible", () => {
    dom.window.renderPortfolio({ positions: [pos({ cgId: "bitcoin", qty: 1, invested: 100 })] }, []);
    dom.window.renderTransactionCalculator();

    dom.window.document.getElementById("tx-asset").value = "bitcoin";
    dom.window.document.getElementById("tx-type").value = "vente";
    dom.window.document.getElementById("tx-price").value = "100";
    dom.window.document.getElementById("tx-qty").value = "5";
    dom.window.document.getElementById("tx-calc-btn").click();

    const resultEl = dom.window.document.getElementById("tx-result");
    expect(resultEl.textContent).toMatch(/position actuelle/);
    expect(resultEl.querySelector("pre")).toBeNull();
  });
});
