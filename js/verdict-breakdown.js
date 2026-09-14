// Décomposition du verdict en 5 catégories — implémentation exacte de
// docs/verdict-methodology.md, ne pas diverger de ce document sans le mettre à jour en même
// temps. Fonctions pures (aucun DOM, aucun fetch), testées isolément dans
// test/verdict-breakdown.test.js. Charge après portfolio.js (normalizeRecommendation,
// VERDICT_THESIS_CONFLICTS) et allocation.js dans index.html.
//
// Règle absolue (voir le document) : une catégorie sans donnée réelle suffisante retourne null
// (rendu "Donnée insuffisante"), jamais un chiffre deviné. Ce fichier ne calcule NULLE PART un
// score global combiné — volontairement absent, pas oublié.

const VERDICT_CATEGORY_ORDER = ["momentum", "fondamentaux", "tokenomics", "valorisation", "risque"];
const VERDICT_CATEGORY_LABELS = {
  momentum: "Momentum",
  fondamentaux: "Fondamentaux",
  tokenomics: "Tokenomics",
  valorisation: "Valorisation",
  risque: "Risque",
};

// Section "Momentum" de la méthodologie : seule catégorie couverte pour les 15 favoris
// aujourd'hui (signal_consensus.technique + confidence_pct, verdicts.json).
function scoreMomentum(verdict) {
  if (!verdict || !verdict.signal_consensus || !verdict.signal_consensus.technique) return null;
  const t = verdict.signal_consensus.technique;
  const conf = typeof verdict.confidence_pct === "number" ? verdict.confidence_pct : null;
  const strong = conf !== null && conf >= 65;
  if (t === "haussier") {
    let score = strong ? 8 : 6;
    if (strong && verdict.signal_consensus.accord_count >= 2) score += 1;
    return Math.min(score, 10);
  }
  if (t === "baissier") return strong ? 1 : 3;
  return 5; // mixte / neutre
}

// Section "Fondamentaux" : uniquement quand portfolio-thesis.json a une entrée conviction
// chiffrée pour cet actif — le texte bull/base/bear seul (favoris-context.json) ne suffit pas
// à noter (voir le document, il reste affiché tel quel ailleurs sur la fiche).
function scoreFondamentaux(thesisEntry) {
  if (!thesisEntry || typeof thesisEntry.conviction !== "number") return null;
  const rec = typeof normalizeRecommendation === "function" ? normalizeRecommendation(thesisEntry.recommendation) : null;
  const conv = thesisEntry.conviction;
  if (rec === "renforcer") return conv >= 7 ? 9 : 6;
  if (rec === "conserver") return conv >= 7 ? 7 : 4;
  if (rec === "attendre") return 4;
  if (rec === "reduire") return conv >= 7 ? 1 : 2;
  return null;
}

// Section "Tokenomics" : part de l'offre max déjà en circulation (circulating/max, CoinGecko —
// voir fetchFavorisSupply, prices.js, ajouté le 14/09/2026). Ratio brut comme scoreValorisation,
// pas un score 0-10 : "50% en circulation" n'est ni bon ni mauvais en soi, ça dépend du calendrier
// d'unlocks réel (pas connu ici) — juste une mesure honnête de dilution potentielle restante.
// PAS de fausse alerte "unlocks inconnus" pour un token sans plafond : `uncapped:true` est un fait
// réel et connu (pas de max supply défini), pas une donnée manquante — même logique que
// scoreRisque ci-dessous (l'absence d'un signal EST parfois l'information). Reste partiel : ne
// capture ni allocation équipe/investisseurs ni calendrier de déblocage précis (voir le document,
// "prochaines étapes" — recherche qualitative confiée à la routine favoris-quotidien).
function scoreTokenomics(supplyEntry) {
  if (!supplyEntry || typeof supplyEntry.circulatingSupply !== "number") return null;
  if (typeof supplyEntry.maxSupply !== "number" || supplyEntry.maxSupply <= 0) return { uncapped: true };
  return { circulatingPct: (supplyEntry.circulatingSupply / supplyEntry.maxSupply) * 100 };
}

// Section "Valorisation" : marketcap ET une mesure d'activité réelle (TVL) pour le MÊME actif,
// toutes deux requises. Retourne le ratio brut plutôt qu'un score 0-10 — construire une
// fourchette "attractif/raisonnable/cher" demanderait un historique du ratio lui-même, qui
// n'existe pas encore (voir le document, section "prochaines étapes").
function scoreValorisation(marketCapUsd, tvlUsd) {
  if (typeof marketCapUsd !== "number" || typeof tvlUsd !== "number" || tvlUsd <= 0) return null;
  return { ratio: marketCapUsd / tvlUsd };
}

// Section "Risque" : annotation qualitative (pas 0-10, trop peu de dimensions réelles pour une
// échelle fine) — jamais "Donnée insuffisante" ici, l'absence de signal négatif connu EST
// l'information (contrairement aux autres catégories où l'absence de donnée n'en est pas une).
function scoreRisque(verdict, thesisEntry) {
  let signals = 0;
  if (verdict && verdict.signal_precoce && verdict.signal_precoce.threshold_crossed) signals += 1;
  const rec = thesisEntry && typeof normalizeRecommendation === "function" ? normalizeRecommendation(thesisEntry.recommendation) : null;
  if (verdict && rec && typeof VERDICT_THESIS_CONFLICTS !== "undefined" && VERDICT_THESIS_CONFLICTS[verdict.verdict] === rec) signals += 1;
  if (signals === 0) return "faible";
  if (signals === 1) return "modéré";
  return "élevé";
}

function computeVerdictBreakdown({ verdict, thesisEntry, marketCapUsd, tvlUsd, supplyEntry } = {}) {
  return {
    momentum: scoreMomentum(verdict),
    fondamentaux: scoreFondamentaux(thesisEntry),
    tokenomics: scoreTokenomics(supplyEntry),
    valorisation: scoreValorisation(marketCapUsd, tvlUsd),
    risque: scoreRisque(verdict, thesisEntry),
  };
}

const VERDICT_RISQUE_LABEL = { faible: "Faible", "modéré": "Modéré", "élevé": "Élevé" };

function renderVerdictBreakdown(breakdown) {
  const rows = VERDICT_CATEGORY_ORDER.map((key) => {
    const label = VERDICT_CATEGORY_LABELS[key];
    if (key === "risque") {
      const v = breakdown.risque;
      const cls = v === "faible" ? "positive" : v === "élevé" ? "negative" : "";
      return `<div class="verdict-cat-row"><span class="hint">${label}</span><strong class="${cls}">${VERDICT_RISQUE_LABEL[v] || "—"}</strong></div>`;
    }
    if (key === "valorisation") {
      const v = breakdown.valorisation;
      return `<div class="verdict-cat-row"><span class="hint">${label}</span><strong>${v ? `Marketcap/TVL ${v.ratio.toFixed(1)}×` : "Donnée insuffisante"}</strong></div>`;
    }
    if (key === "tokenomics") {
      const v = breakdown.tokenomics;
      const text = !v ? "Donnée insuffisante" : v.uncapped ? "Offre non plafonnée" : `${v.circulatingPct.toFixed(0)} % de l'offre max en circulation`;
      return `<div class="verdict-cat-row"><span class="hint">${label}</span><strong>${text}</strong></div>`;
    }
    const v = breakdown[key];
    return `<div class="verdict-cat-row"><span class="hint">${label}</span><strong>${typeof v === "number" ? `${v}/10` : "Donnée insuffisante"}</strong></div>`;
  }).join("");
  return `<div class="verdict-breakdown">
    <strong>Décomposition du verdict</strong>
    <p class="hint">Chaque catégorie n'est notée que si une donnée réelle suffisante existe pour cet actif précis — jamais de score global combiné tant qu'une catégorie manque.</p>
    ${rows}
  </div>`;
}
