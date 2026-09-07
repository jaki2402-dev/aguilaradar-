// "Où placer ma prochaine recharge ?" — classement transparent des 15 positions du portefeuille
// par attractivité RELATIVE, à partir des seules données déjà calculées ailleurs sur le site
// (verdict technique, thèse hebdo, contexte fondamental favoris-context.json, exposition déjà
// détenue). Jamais un score unique à fausse précision (ex. "82/100") : le classement repose sur
// un total de points INTERNE, jamais affiché tel quel, qui ne sert qu'à trier et à départager —
// ce qui est montré, c'est toujours une catégorie (5 paliers) + les raisons explicites + un
// niveau de confiance + les données manquantes, conformément à la règle "éviter la fausse
// précision" demandée explicitement par l'utilisateur. Aucun appel réseau ici : tout vient de
// données déjà chargées en mémoire par ailleurs (verdicts/thèse/favoris-context/prix).
//
// Volontairement scindé de portfolio.js (déjà 800+ lignes) : une préoccupation distincte
// (comparaison inter-positions pour une décision d'allocation, pas le calcul de valeur/P&L d'une
// position individuelle), plus facile à tester isolément.

// Dimensions du score interne (jamais affiché brut) — seulement 2 : verdict technique (14j,
// moteur) et thèse hebdo (recherche web réelle), les 2 SEULES dimensions couvertes à 15/15 sur
// le portefeuille actuel. Tout le reste (smart money/onchain, concentration déjà détenue, signal
// précoce, désaccord verdict/thèse) est une ANNOTATION qualitative séparée, jamais fondue dans ce
// total : ces signaux sont soit trop épars (3/15 favoris seulement ont un onchain_signal
// disponible aujourd'hui), soit conceptuellement différents ("bon actif" vs "bon endroit pour PLUS
// de capital MAINTENANT" — mélanger les deux masquerait justement la distinction que la section 3
// de la demande utilisateur exige de préserver).
function verdictPoints(verdict) {
  if (!verdict || !verdict.verdict) return { points: 0, available: false };
  const conf = verdict.confidence_pct;
  const strong = typeof conf === "number" && conf >= 65;
  if (verdict.verdict === "ACHAT") return { points: strong ? 2 : 1, available: true };
  if (verdict.verdict === "VENTE") return { points: strong ? -2 : -1, available: true };
  return { points: 0, available: true }; // ATTENTE
}

function thesisPoints(thesisEntry) {
  if (!thesisEntry) return { points: 0, available: false };
  const rec = normalizeRecommendation(thesisEntry.recommendation);
  const conviction = typeof thesisEntry.conviction === "number" ? thesisEntry.conviction : 5;
  const weight = Math.max(0.4, Math.min(1, conviction / 10)); // conviction faible amortit le poids, jamais à zéro (une thèse existe quand même)
  const base = rec === "renforcer" ? 2 : rec === "reduire" ? -2 : rec === "attendre" ? -0.5 : 1; // "conserver" -> +1 (lecture positive mais moins qu'un renforcement actif)
  return { points: base * weight, available: !!rec };
}

const TIER_BANDS = [
  { min: 3, label: "Très attractive" },
  { min: 1, label: "Attractive" },
  { min: -1, label: "Neutre" },
  { min: -3, label: "Peu attractive" },
  { min: -Infinity, label: "À éviter actuellement" },
];
function tierForPoints(points) {
  return TIER_BANDS.find((b) => points >= b.min).label;
}

// Réutilise telles quelles les 5 couleurs de badge déjà définies (style.css) pour
// verdict/thèse (vert/violet/gris/jaune/rouge) — jamais une 6e couleur inventée pour ce
// classement. Le texte affiché reste toujours le libellé de palier en clair (jamais "achat"),
// seule la couleur est empruntée.
const TIER_BADGE_CLASS = {
  "Très attractive": "badge-achat",
  "Attractive": "badge-conserver",
  "Neutre": "badge-neutral",
  "Peu attractive": "badge-attente",
  "À éviter actuellement": "badge-vente",
  "Donnée insuffisante": "badge-neutral",
};
function tierBadgeClass(tier) {
  return TIER_BADGE_CLASS[tier] || "badge-neutral";
}

// Écart minimal pour dire que deux positions se distinguent vraiment plutôt que d'être
// "quasi ex-æquo" — demande explicite de l'utilisateur : ne jamais présenter un classement
// serré comme une hiérarchie nette. Pas une science exacte : la moitié de l'amplitude d'un seul
// "cran" (verdict fort = 2 points) sert de repère raisonnable, documenté ici plutôt qu'inventé
// silencieusement.
const CLOSE_GAP_THRESHOLD = 1;

// Reprend exactement la même lecture "contradiction franche" que renderPortfolioSignalConflicts
// (portfolio.js) — jamais un 2e jugement de désaccord recalculé différemment pour le même couple
// verdict/thèse.
function hasSignalConflict(verdict, recommendation) {
  return !!(verdict && recommendation && VERDICT_THESIS_CONFLICTS[verdict] === recommendation);
}

// Un seul point d'assemblage par position — factorise ce que rankPortfolioAttractiveness (ci-
// dessous) ET l'Assistant (assistant.js, question ciblée sur un actif précis) doivent pouvoir
// appeler pour UNE position sans reconstruire tout le classement des 15.
function computePositionAttractiveness(pos, verdict, thesisEntry, favContextEntry, valueShare) {
  const v = verdictPoints(verdict);
  const t = thesisPoints(thesisEntry);
  const points = v.points + t.points;
  const bothMissing = !v.available && !t.available;
  const tier = bothMissing ? "Donnée insuffisante" : tierForPoints(points);

  const reasons = [];
  const caveats = [];
  const missingData = [];

  if (v.available) {
    reasons.push(`Verdict technique (14j) ${verdict.verdict}${typeof verdict.confidence_pct === "number" ? ` (confiance ${verdict.confidence_pct} %)` : ""}`);
  } else {
    missingData.push("Verdict technique du moteur");
  }
  if (t.available) {
    const conv = typeof thesisEntry.conviction === "number" ? `, conviction ${thesisEntry.conviction}/10` : "";
    reasons.push(`Thèse hebdo (recherche réelle) : ${thesisEntry.recommendation}${conv}`);
  } else {
    missingData.push("Thèse fondamentale hebdo");
  }

  // Signal précoce (verdicts.json) : le mouvement de prix CONTREDIT déjà le verdict actif avant
  // même son échéance — un vrai signal d'alerte trouvé dans une donnée déjà écrite par la
  // routine, jamais recalculé ici. threshold_crossed=true veut dire que le seuil directionnel est
  // déjà franchi dans le sens opposé au verdict.
  if (verdict && verdict.signal_precoce && verdict.signal_precoce.threshold_crossed) {
    caveats.push(`Signal précoce déjà défavorable au verdict en cours (${verdict.signal_precoce.note || "seuil directionnel franchi avant l'échéance"}).`);
  }

  // Désaccord franc verdict/thèse (même règle que portfolio.js) : la position mérite d'être
  // regardée avant d'y ajouter du capital, quel que soit le total de points ci-dessus.
  const recSlug = t.available ? normalizeRecommendation(thesisEntry.recommendation) : null;
  if (hasSignalConflict(verdict && verdict.verdict, recSlug)) {
    caveats.push("Le verdict technique et la thèse hebdo pointent dans des directions opposées — signal à regarder avant d'agir, pas juste un chiffre à sommer.");
  }

  // Smart money / on-chain (favoris-context.json) : présent pour seulement 3/15 favoris
  // aujourd'hui (ETH, LINK, ARB au 07/09) — jamais estimé pour les autres, listé en donnée
  // manquante plutôt que silencieusement ignoré.
  if (favContextEntry && favContextEntry.onchain_signal && favContextEntry.onchain_signal.available) {
    caveats.push(`Signal on-chain récent disponible : ${favContextEntry.onchain_signal.note || "voir Contexte élargi"}.`);
  } else {
    missingData.push("Flux whales / on-chain récents");
  }
  if (favContextEntry && favContextEntry.open_interest && typeof favContextEntry.open_interest.value_usd === "number") {
    reasons.push(`Open interest ${(favContextEntry.open_interest.value_usd / 1e6).toFixed(0)} M$ (${favContextEntry.open_interest.source || "source non précisée"}).`);
  } else {
    missingData.push("Open interest / positionnement dérivés");
  }
  missingData.push("Flux ETF/institutionnels dédiés à cet actif", "Calendrier précis des unlocks de tokens");

  // Concentration déjà détenue : à dessein PAS mélangé au total de points ci-dessus (un actif
  // déjà largement détenu n'est pas un "moins bon actif" — c'est un endroit où AJOUTER du
  // capital a un coût d'opportunité différent, exactement la distinction demandée section 3).
  if (valueShare !== null && valueShare !== undefined) {
    if (valueShare >= THRESHOLDS.concentrationWarningPct) {
      caveats.push(`Déjà ${valueShare.toFixed(0)} % du portefeuille — une recharge ici concentre plutôt que diversifie.`);
    } else if (valueShare === 0) {
      caveats.push("Position actuellement nulle ou non configurée — un renforcement ici serait une nouvelle ouverture, pas un ajout.");
    }
  }

  let confidenceLevel = "moyen";
  const strongVerdict = verdict && typeof verdict.confidence_pct === "number" && verdict.confidence_pct >= 65;
  const strongThesis = thesisEntry && typeof thesisEntry.conviction === "number" && thesisEntry.conviction >= 7;
  const weakThesis = thesisEntry && typeof thesisEntry.conviction === "number" && thesisEntry.conviction <= 4;
  const agreement = verdict && verdict.signal_consensus && typeof verdict.signal_consensus.accord_count === "number" ? verdict.signal_consensus.accord_count : null;
  if (bothMissing || caveats.length >= 2 || weakThesis) {
    confidenceLevel = "faible";
  } else if (v.available && t.available && strongVerdict && strongThesis && (agreement === null || agreement >= 2) && caveats.length === 0) {
    confidenceLevel = "élevé";
  }

  return { points, tier, confidenceLevel, reasons, caveats, missingData: Array.from(new Set(missingData)) };
}

// Classement complet des 15 positions — réutilise latestVerdictFor/normalizeRecommendation
// (portfolio.js, chargé avant ce fichier) et FAVORIS/SECTOR_FAMILIES/THRESHOLDS (config.js),
// jamais une 2e implémentation. positions = summary.positions déjà produit par
// computePortfolioSummary (portfolio.js) — aucun recalcul de valeur/P&L ici.
function rankPortfolioAttractiveness(positions, verdicts, thesis, favorisContext) {
  const thesisByAsset = (thesis && thesis.positions) || {};
  const favCtxByTicker = (favorisContext && favorisContext.assets) || {};
  const totalValue = (positions || []).reduce((sum, p) => sum + (p.value || 0), 0);

  const ranked = (positions || []).map((p) => {
    const verdict = latestVerdictFor(p.cgId, verdicts);
    const thesisEntry = thesisByAsset[p.cgId] || null;
    const favContextEntry = favCtxByTicker[p.ticker] || null;
    const valueShare = !p.pending && totalValue > 0 ? ((p.value || 0) / totalValue) * 100 : p.pending ? null : 0;
    const result = computePositionAttractiveness(p, verdict, thesisEntry, favContextEntry, valueShare);
    return { cgId: p.cgId, ticker: p.ticker, name: p.name, sectorColor: p.sectorColor, valueShare, ...result };
  });

  ranked.sort((a, b) => b.points - a.points);
  ranked.forEach((r, i) => {
    const next = ranked[i + 1];
    r.closeCallWith = next && Math.abs(r.points - next.points) < CLOSE_GAP_THRESHOLD ? next.ticker : null;
  });
  return ranked;
}

// Résumé compact texte pour le contexte envoyé au relais IA (assistant.js buildAiContext) — les
// listes reasons/caveats/missingData restent structurées côté JS (rendu HTML) et sont seulement
// aplaties en phrases ici, jamais 2 formulations différentes de la même donnée.
function formatAttractivenessForAiContext(ranked) {
  return ranked
    .map((r, i) => {
      const bits = [`#${i + 1} ${r.ticker} — ${r.tier} (confiance ${r.confidenceLevel})`];
      if (r.reasons.length) bits.push(r.reasons.join("; "));
      if (r.caveats.length) bits.push("Points de vigilance : " + r.caveats.join(" "));
      if (r.valueShare !== null) bits.push(`Déjà ${r.valueShare.toFixed(0)} % du portefeuille`);
      if (r.closeCallWith) bits.push(`quasi ex-æquo avec ${r.closeCallWith} — écart marginal`);
      return bits.join(". ");
    })
    .join("\n");
}
