import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

// Demande utilisateur (10/10/2026) : textes plus courts, l'essentiel mis en avant. Le résumé d'un
// verdict vient de ses champs structurés (jamais reformulé) ; le texte complet reste accessible.

// Verdict réel du 10/10/2026 (data/verdicts.json, v-20261010-ctsi), raisonnement abrégé.
const CTSI = {
  id: "v-20261010-ctsi",
  asset: "cartesi",
  ticker: "CTSI",
  verdict: "ACHAT",
  issued_at: "2026-10-10T16:20:00Z",
  confidence_pct: 65,
  horizon_days: 7,
  status: "pending",
  signals_used: [
    "24h +5,06%",
    "7j +15,83%",
    "30j +44,27%",
    "portfolio-thesis Attendre conviction 3/10",
    "Aucune actualite recente confirmee (derniere mise a jour officielle Cartesi trouvee : juillet 2026)",
  ],
  signal_consensus: { technique: "haussier", fondamental: "neutre", macro: "neutre", accord_count: 2 },
  reasoning: "Aucun verdict pending n'existait pour CTSI ce cycle : le precedent a ete resolu. Nouveau cycle : lecture technique haussiere coherente sur les trois fenetres.",
};

function page(html = "<!doctype html><html><body><div id='out'></div></body></html>") {
  return loadPage(["config.js", "portfolio.js"], { html });
}

describe("renderVerdictSummary / renderVerdictText (config.js)", () => {
  it("résume avec les 3 lectures et les 3 premiers signaux courts, sans reformuler", () => {
    const dom = page();
    const out = dom.window.document.getElementById("out");
    out.innerHTML = dom.window.renderVerdictSummary(CTSI);
    const chips = [...out.querySelectorAll(".consensus-chip")].map((c) => `${c.className}|${c.textContent}`);
    expect(chips).toEqual([
      "consensus-chip consensus-haussier|Technique : haussier",
      "consensus-chip consensus-neutre|Fondamental : neutre",
      "consensus-chip consensus-neutre|Macro : neutre",
    ]);
    expect([...out.querySelectorAll(".verdict-signals li")].map((li) => li.textContent)).toEqual(["24h +5,06%", "7j +15,83%", "30j +44,27%"]);
  });

  it("ignore un signal long (une phrase, pas un point clé) et échappe une valeur inattendue", () => {
    const dom = page();
    const out = dom.window.document.getElementById("out");
    out.innerHTML = dom.window.renderVerdictSummary({ signal_consensus: { technique: "<img src=x onerror=alert(1)>" }, signals_used: [CTSI.signals_used[4]] });
    expect(out.querySelector("img")).toBeNull();
    expect(out.querySelector(".consensus-chip").className).toBe("consensus-chip consensus-neutre");
    expect(out.querySelector(".verdict-signals")).toBeNull();
  });

  it("garde le raisonnement complet, masqué derrière « Lire l'analyse complète » qui le déplie", () => {
    const dom = page();
    const out = dom.window.document.getElementById("out");
    out.innerHTML = dom.window.renderVerdictText(CTSI);
    dom.window.wireClampToggles(out);
    const full = out.querySelector(".clamp-hidden");
    expect(full.textContent).toContain("lecture technique haussiere");
    const toggle = out.querySelector("[data-clamp-target]");
    expect(toggle.textContent).toContain("Lire l'analyse complète");
    toggle.click();
    expect(full.classList.contains("clamp-open")).toBe(true);
  });

  it("verdict ancien sans champs structurés : aperçu habituel, aucun résumé inventé", () => {
    const dom = page();
    const html = dom.window.renderVerdictText({ reasoning: "Court." });
    expect(html).not.toContain("verdict-summary");
    expect(html).toBe("<p>Court.</p>");
  });

  it("renderReasoningFor : résumé seulement si le texte est bien celui du dernier verdict de l'actif", () => {
    const dom = page();
    dom.window.aguilaradarData = { verdicts: [CTSI] };
    expect(dom.window.renderReasoningFor("cartesi", CTSI.reasoning)).toContain("verdict-summary");
    expect(dom.window.renderReasoningFor("cartesi", "Un autre texte.")).not.toContain("verdict-summary");
  });
});

describe("textes longs : aperçu + « Lire plus »", () => {
  const LONG = "Mise a jour Ethereum Glamsterdam : activation prevue sur le testnet Sepolia le 6 octobre 2026, integrant EIP-7732 et EIP-7928 — plus gros changement d'architecture depuis The Merge selon plusieurs sources ; date de mainnet non fixee (Q4 2026 vise).";

  it("actualité longue : 2 lignes dans le lien, bouton « Lire plus » hors du lien", () => {
    const dom = loadPage(["config.js", "app.js"], { html: "<!doctype html><html><body><div id='news-body'></div></body></html>" });
    dom.window.renderNews({ items: [{ title: LONG, url: "https://example.com/a", source: "X" }, { title: "Court titre", url: "https://example.com/b", source: "Y" }] });
    const body = dom.window.document.getElementById("news-body");
    const [longItem, shortItem] = [...body.querySelectorAll(".news-item")].reverse(); // affichage du plus récent au plus ancien
    expect(longItem.querySelector("a .clamp-text.clamp-2")).not.toBeNull();
    const toggle = longItem.querySelector("[data-clamp-target]");
    expect(toggle.closest("a")).toBeNull();
    toggle.click();
    expect(longItem.querySelector(".clamp-text").classList.contains("clamp-open")).toBe(true);
    expect(shortItem.querySelector("[data-clamp-target]")).toBeNull();
  });

  it("note longue du contexte marché : titre visible, aperçu + « Lire plus »", () => {
    const dom = loadPage(["config.js", "prices.js", "cards.js", "insights.js"], { html: "<!doctype html><html><body><div id='market-context-body'></div></body></html>" });
    dom.window.renderMarketContext({ last_computed_at: "2026-10-10T08:50:00Z", employment_us: { unemployment_rate_pct: 4.2, market_reaction_note: LONG } });
    const note = dom.window.document.querySelector("#market-context-body .context-note");
    expect(note.querySelector("strong").textContent).toBe("Emploi");
    expect(note.querySelector(".clamp-text")).not.toBeNull();
    note.querySelector("[data-clamp-target]").click();
    expect(note.querySelector(".clamp-text").classList.contains("clamp-open")).toBe(true);
  });
});

describe("Journal : date lisible", () => {
  it("affiche « 10/10/2026 16:20 » plutôt que l'horodatage brut", () => {
    const dom = loadPage(["config.js", "app.js"]);
    expect(dom.window.formatIssuedAt("2026-10-10T16:20:00Z")).toMatch(/^10\/10\/2026 \d{2}:20$/);
    expect(dom.window.formatIssuedAt("pas une date")).toBe("pas une date");
  });
});


describe("champ resume écrit par les routines (ajout du 10/10/2026) : en tête, texte complet replié", () => {
  const RESUME = "Hausse confirmée sur 24 h, 7 jours et 30 jours, sans catalyseur fondamental confirmé.";

  it("verdict : la phrase de la routine passe avant les pastilles, l'analyse complète reste dépliable", () => {
    const dom = loadPage(["config.js"], { html: "<!doctype html><html><body><div id='out'></div></body></html>" });
    const out = dom.window.document.getElementById("out");
    out.innerHTML = dom.window.renderVerdictText({ ...CTSI, resume: RESUME });
    expect(out.firstElementChild.className).toBe("text-resume");
    expect(out.querySelector(".text-resume").textContent).toBe(RESUME);
    expect(out.querySelector(".verdict-summary")).not.toBeNull();
    expect(out.querySelector(".clamp-hidden").textContent).toContain("lecture technique haussiere");
  });

  it("renderSummaryFirst : sans resume, aperçu habituel ; resume vide ou non textuel ignoré", () => {
    const dom = loadPage(["config.js"]);
    expect(dom.window.renderSummaryFirst(undefined, "Texte.")).toBe("<p>Texte.</p>");
    expect(dom.window.renderSummaryFirst("  ", "Texte.")).toBe("<p>Texte.</p>");
    expect(dom.window.renderSummaryFirst(42, "Texte.")).toBe("<p>Texte.</p>");
  });

  it("actualité : le résumé devient le lien, le texte complet est replié et l'alerte « À surveiller » lit toujours le texte complet", () => {
    const dom = loadPage(["config.js", "app.js"], { html: "<!doctype html><html><body><div id='news-body'></div></body></html>" });
    const long = "Hack majeur sur une plateforme d'échange : 120 M$ dérobés selon plusieurs sources, retraits suspendus, enquête en cours et remboursement promis aux utilisateurs touchés.";
    dom.window.renderNews({ items: [{ title: long, resume: "Hack de 120 M$ sur une plateforme d'échange, retraits suspendus.", url: "https://example.com/a", source: "X" }] });
    const item = dom.window.document.querySelector("#news-body .news-item");
    expect(item.querySelector("a").textContent).toBe("Hack de 120 M$ sur une plateforme d'échange, retraits suspendus.");
    expect(item.querySelector(".clamp-hidden").textContent).toBe(long);
    expect(item.querySelector("[data-clamp-target]").closest("a")).toBeNull();
  });

  it("note du contexte marché et thèse long terme : résumé en tête", () => {
    const dom = loadPage(["config.js", "prices.js", "cards.js", "insights.js"], { html: "<!doctype html><html><body><div id='market-context-body'></div></body></html>" });
    dom.window.renderMarketContext({ last_computed_at: "2026-10-10T08:50:00Z", employment_us: { unemployment_rate_pct: 4.2, market_reaction_note: "Note longue.", resume: "Emploi faible, chômage à 4,2 %." } });
    const note = dom.window.document.querySelector("#market-context-body .context-note");
    expect(note.querySelector(".text-resume").textContent).toBe("Emploi faible, chômage à 4,2 %.");
    expect(note.querySelector(".clamp-hidden").textContent).toBe("Note longue.");
  });
});

describe("régime de marché : resume transmis par macroView", () => {
  it("expose le resume écrit par le cycle à côté de la note", () => {
    const dom = loadPage(["config.js", "app.js"]);
    const m = dom.window.macroView({ macro_regime: { regime: "neutre", last_computed_at: new Date().toISOString(), note: "Note longue.", resume: "Régime neutre : Fed restrictive, emploi qui ralentit." } }, null);
    expect(m.resume).toBe("Régime neutre : Fed restrictive, emploi qui ralentit.");
    expect(m.note).toBe("Note longue.");
  });
});
