// Contrôles de cohérence sur des données DÉJÀ chargées (data/*.json) — ne corrige JAMAIS rien,
// signale seulement ("à vérifier" / "périmé") : corriger reste le travail des routines qui
// écrivent ces fichiers (voir docs/routines/), jamais du frontend qui ne fait que lire. Fonctions
// pures (aucun DOM, aucun fetch), testées isolément dans test/data-integrity.test.js — le rendu
// vit dans detail.js (badge par favori) et insights.js (résumé "Cohérence des données").

const DATA_INTEGRITY_DEFAULTS = { warnDays: 10, staleDays: 21 };

// Fraîcheur d'UN timestamp isolé — brique de base réutilisée à la fois pour un favori individuel
// (renderFavorisContextSection, detail.js) et pour balayer les 15 d'un coup
// (checkFavorisContextFreshness ci-dessous). Même vocabulaire à 3 niveaux que FRESHNESS_SOURCES
// (app.js, qui juge des FICHIERS entiers) — ok/warning/stale — pour ne pas inventer un 4e état.
function freshnessStatusForDate(dateStr, opts) {
  if (!dateStr) return null;
  const { warnDays, staleDays } = Object.assign({}, DATA_INTEGRITY_DEFAULTS, opts);
  const ageDays = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  if (Number.isNaN(ageDays)) return null;
  const status = ageDays > staleDays ? "stale" : ageDays > warnDays ? "warning" : "ok";
  return { ageDays, status };
}

// Fraîcheur PAR ACTIF du contexte étendu (favoris-context.json) — à ne pas confondre avec
// FRESHNESS_SOURCES (app.js), qui juge des fichiers entiers. Ici chaque favori a son propre
// last_computed_at (rotation quotidienne, pas tous recalculés le même cycle) : un favori
// individuellement périmé peut se cacher derrière un fichier globalement "frais".
function checkFavorisContextFreshness(favorisContext, opts) {
  const assets = (favorisContext && favorisContext.assets) || {};
  return Object.entries(assets)
    .map(([ticker, entry]) => {
      const f = entry && freshnessStatusForDate(entry.last_computed_at, opts);
      return f && { ticker, lastComputedAt: entry.last_computed_at, ageDays: f.ageDays, status: f.status };
    })
    .filter(Boolean);
}

// Bornes de plausibilité minimales sur les verdicts déjà écrits — jamais un jugement sur la
// QUALITÉ du verdict, seulement "cette valeur peut-elle physiquement être correcte" (confiance
// hors 0-100 %, horizon ou prix nul/négatif). Signale, ne corrige jamais.
function checkVerdictPlausibility(verdicts) {
  const issues = [];
  (verdicts || []).forEach((v) => {
    if (typeof v.confidence_pct === "number" && (v.confidence_pct < 0 || v.confidence_pct > 100)) {
      issues.push({ id: v.id, ticker: v.ticker, field: "confidence_pct", value: v.confidence_pct, issue: "hors de la plage 0-100 %" });
    }
    if (typeof v.horizon_days === "number" && v.horizon_days <= 0) {
      issues.push({ id: v.id, ticker: v.ticker, field: "horizon_days", value: v.horizon_days, issue: "horizon nul ou négatif" });
    }
    if (typeof v.price_at_issue === "number" && v.price_at_issue <= 0) {
      issues.push({ id: v.id, ticker: v.ticker, field: "price_at_issue", value: v.price_at_issue, issue: "prix nul ou négatif" });
    }
  });
  return issues;
}

// Résumé compact pour le panneau "Cohérence des données" (insights.js, à côté de la santé
// technique du pipeline) — agrège les contrôles ci-dessus sans jamais en déduire une correction,
// juste un décompte + le détail pour investigation manuelle côté routine concernée.
function summarizeDataIntegrity(favorisContext, verdicts) {
  const staleFavoris = checkFavorisContextFreshness(favorisContext).filter((f) => f.status !== "ok");
  const plausibilityIssues = checkVerdictPlausibility(verdicts);
  return { staleFavoris, plausibilityIssues, totalIssues: staleFavoris.length + plausibilityIssues.length };
}
