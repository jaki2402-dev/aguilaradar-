// Laboratoire du moteur (lancé par scripts/technical-favoris.mjs, GitHub Action technical-daily,
// aucun quota Claude). Pourquoi : 82 verdicts vérifiés sont trop peu pour savoir ce qui prédit
// vraiment. L'historique réel des cours (CoinGecko, 1 an) permet de rejouer la question du moteur —
// « +5 % ou −5 % à l'horizon de l'actif (7 ou 14 j) ? » — pour chaque favori et chaque jour : ~2 000
// cas RÉELS, même définition que la résolution des verdicts (seuil ±5 %, même horizon par actif).
// Chaque soir :
// - valeur prédictive de chaque indicateur (terciles, mesurée sur deux périodes séparées) ;
// - une règle apprise sur la période ancienne, notée sur la période récente qu'elle n'a pas vue ;
// - toutes les règles candidates notées de la même façon (choix de la règle du moteur) ;
// - analyse des erreurs de la règle en place (situations où elle se trompe le plus / le moins) ;
// - calibration de la confiance sur la période récente.
// Rien n'est inventé : sans historique suffisant, l'actif ou le jour est simplement écarté.

const DAY_MS = 86400000;
const CLASSES = ["ACHAT", "ATTENTE", "VENTE"];
export const TRAIN_SHARE = 0.6; // 60 % des jours les plus anciens pour apprendre, 40 % récents pour noter
export const MIN_LEAF = 60; // une branche de la règle apprise doit couvrir au moins 60 cas
const round = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

// Indicateurs utilisables par une règle, avec leur nom lisible (affiché sur le site).
export const FEATURES = {
  rsi14: "RSI 14 j",
  sma200_gap_pct: "Écart à la moyenne 200 j",
  macd_histogram: "Élan MACD",
  change_7d: "Évolution 7 j",
  change_30d: "Évolution 30 j",
  volatility_30d_pct: "Volatilité 30 j",
  drawdown_pct: "Repli depuis le plus haut",
  valuation_percentile: "Valorisation (centile 1 an)",
  volume_ratio: "Volume 7 j / 30 j",
  rel_strength_30d: "Force relative vs BTC (30 j)",
  btc_macd: "Élan du bitcoin",
  btc_gap: "Bitcoin vs sa moyenne 200 j",
  btc_rsi: "RSI du bitcoin",
  fng: "Peur / cupidité",
};

// Un point par jour (le premier, 00h00 UTC chez CoinGecko) ; le point « maintenant » est écarté.
export function dailySeries(points) {
  const out = [];
  let lastDay = null;
  for (const p of points || []) {
    const day = Math.floor(p[0] / DAY_MS);
    if (day === lastDay) continue;
    lastDay = day;
    out.push({ day, value: p[1] });
  }
  return out;
}

export function classify(movePct, threshold = 5) {
  if (movePct >= threshold) return "ACHAT";
  if (movePct <= -threshold) return "VENTE";
  return "ATTENTE";
}

// Indicateurs d'un actif au jour d'index i (seuls les cours connus ce jour-là sont utilisés).
// asset : { closes:[{day,value}], volByDay: Map, valuation: [{day,ratio}] } ; btc : idem pour BTC.
export function featuresAt(asset, i, btcIndexByDay, btc, fngByDay, deps) {
  const closes = asset.closes.slice(0, i + 1).map((c) => c.value);
  const ind = deps.indicatorsAt(closes, deps.site);
  if (!ind) return null;
  const day = asset.closes[i].day;
  const bi = btcIndexByDay.get(day);
  const bInd = bi === undefined ? null : btc.cache[bi] || (btc.cache[bi] = deps.indicatorsAt(btc.closes.slice(0, bi + 1).map((c) => c.value), deps.site));
  const avg = (from, to) => {
    const v = [];
    for (let d = from; d <= to; d++) if (asset.volByDay.has(d)) v.push(asset.volByDay.get(d));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const v7 = avg(day - 6, day);
  const v30 = avg(day - 29, day);
  const val = deps.valuationAt(asset.valuation || [], day * DAY_MS);
  return {
    rsi14: ind.rsi14,
    sma200_gap_pct: ind.sma200_gap_pct,
    macd_histogram: ind.macd_histogram,
    change_7d: ind.change_pct["7d"],
    change_30d: ind.change_pct["30d"],
    volatility_30d_pct: ind.volatility_30d_pct,
    drawdown_pct: ind.drawdown_from_365d_high_pct,
    valuation_percentile: val ? val.percentile : null,
    volume_ratio: v7 && v30 ? round(v7 / v30, 2) : null,
    rel_strength_30d: bInd && ind.change_pct["30d"] !== null && bInd.change_pct["30d"] !== null ? round(ind.change_pct["30d"] - bInd.change_pct["30d"], 1) : null,
    btc_macd: bInd ? bInd.macd_histogram : null,
    btc_gap: bInd ? bInd.sma200_gap_pct : null,
    btc_rsi: bInd ? bInd.rsi14 : null,
    fng: fngByDay && fngByDay.has(day) ? fngByDay.get(day) : null,
  };
}

// Les règles candidates prennent (verdict, ind, marché) : on leur présente un cas du laboratoire
// sous cette forme.
export const asRuleInput = (f) => ({ ind: { rsi14: f.rsi14, sma200_gap_pct: f.sma200_gap_pct, macd_histogram: f.macd_histogram }, market: { macd_histogram: f.btc_macd, sma200_gap_pct: f.btc_gap, rsi14: f.btc_rsi } });

// Jeu de cas réels : chaque favori, chaque jour avec 200 jours d'historique et un horizon connu.
export function buildSamples(assets, btc, fngByDay, deps, threshold = 5) {
  const btcIndexByDay = new Map(btc.closes.map((c, i) => [c.day, i]));
  btc.cache = btc.cache || [];
  const samples = [];
  for (const a of assets) {
    const h = a.horizon || 14;
    for (let i = 199; i + h < a.closes.length; i++) {
      const f = featuresAt(a, i, btcIndexByDay, btc, fngByDay, deps);
      if (!f || f.rsi14 === null || f.sma200_gap_pct === null) continue;
      const move = (a.closes[i + h].value / a.closes[i].value - 1) * 100;
      samples.push({ ticker: a.ticker, day: a.closes[i].day, f, actual: classify(move, threshold) });
    }
  }
  return samples;
}

export function splitByTime(samples) {
  const days = [...new Set(samples.map((s) => s.day))].sort((a, b) => a - b);
  const cut = days[Math.floor(days.length * TRAIN_SHARE)];
  return { cutDay: cut, train: samples.filter((s) => s.day < cut), valid: samples.filter((s) => s.day >= cut) };
}

const accuracy = (subset, call) => (subset.length ? round((subset.filter((s) => call(s) === s.actual).length / subset.length) * 100, 1) : null);

export function evaluateRules(rules, train, valid) {
  const out = {};
  for (const [key, rule] of Object.entries(rules)) {
    if (!rule.standalone) continue;
    const call = (s) => {
      const { ind, market } = asRuleInput(s.f);
      return rule.call(null, ind, market);
    };
    out[key] = { train: accuracy(train, call), valid: accuracy(valid, call) };
  }
  return out;
}

// --- Règle apprise : arbre de décision à 2 niveaux (4 branches au plus), seuils = terciles de la
// période d'apprentissage, chaque branche couvre au moins MIN_LEAF cas et prédit l'issue la plus
// fréquente de ses cas. Capacité volontairement faible : lisible et peu sujette au sur-apprentissage.
function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function candidateSplits(train) {
  const splits = [];
  for (const key of Object.keys(FEATURES)) {
    const vals = train.map((s) => s.f[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (vals.length < 2 * MIN_LEAF) continue;
    for (const q of [1 / 3, 2 / 3]) splits.push({ key, threshold: quantile(vals, q) });
  }
  return splits;
}

function majority(subset) {
  const c = { ACHAT: 0, ATTENTE: 0, VENTE: 0 };
  for (const s of subset) c[s.actual] += 1;
  return CLASSES.reduce((a, b) => (c[b] > c[a] ? b : a), "ACHAT");
}

const goesLeft = (s, split) => Number.isFinite(s.f[split.key]) && s.f[split.key] < split.threshold;

function bestSplit(subset, splits) {
  let best = { split: null, correct: subset.filter((s) => s.actual === majority(subset)).length };
  for (const split of splits) {
    const left = subset.filter((s) => goesLeft(s, split));
    const right = subset.filter((s) => !goesLeft(s, split));
    if (left.length < MIN_LEAF || right.length < MIN_LEAF) continue;
    const ml = majority(left);
    const mr = majority(right);
    const correct = left.filter((s) => s.actual === ml).length + right.filter((s) => s.actual === mr).length;
    if (correct > best.correct) best = { split, correct };
  }
  return best.split;
}

export function learnTree(train) {
  const splits = candidateSplits(train);
  const node = (subset, depth) => {
    const split = depth < 2 ? bestSplit(subset, splits) : null;
    if (!split) return { leaf: majority(subset), n: subset.length };
    return { key: split.key, threshold: round(split.threshold, 2), left: node(subset.filter((s) => goesLeft(s, split)), depth + 1), right: node(subset.filter((s) => !goesLeft(s, split)), depth + 1) };
  };
  return node(train, 0);
}

export function treeCall(tree, f) {
  let n = tree;
  while (n && !n.leaf) n = Number.isFinite(f[n.key]) && f[n.key] < n.threshold ? n.left : n.right;
  return n ? n.leaf : "ATTENTE";
}

const fmt = (key, v) => (key === "macd_histogram" || key === "btc_macd" ? (v > 0 ? "positif" : "négatif ou nul") : `${String(v).replace(".", ",")}`);

export function describeTree(tree) {
  const parts = [];
  const walk = (n, conds) => {
    if (n.leaf) {
      parts.push(`${conds.length ? `si ${conds.join(" et ")}` : "toujours"} → ${n.leaf}`);
      return;
    }
    const name = FEATURES[n.key] || n.key;
    walk(n.left, [...conds, `${name} < ${fmt(n.key, n.threshold)}`]);
    walk(n.right, [...conds, `${name} ≥ ${fmt(n.key, n.threshold)}`]);
  };
  walk(tree, []);
  return parts;
}

// --- Valeur prédictive d'un indicateur : part des hausses (≥ +5 %) et des baisses dans son tiers
// bas vs son tiers haut, sur chaque période. « Prédictif » seulement si l'écart va dans le même
// sens sur les DEUX périodes et dépasse 10 points sur chacune (sinon : coïncidence possible).
export function featureReport(samples, train, valid) {
  const report = [];
  for (const [key, name] of Object.entries(FEATURES)) {
    const vals = samples.map((s) => s.f[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (vals.length < 3 * MIN_LEAF) continue;
    const lo = quantile(vals, 1 / 3);
    const hi = quantile(vals, 2 / 3);
    const share = (subset, cls) => (subset.length ? (subset.filter((s) => s.actual === cls).length / subset.length) * 100 : null);
    const part = (subset) => {
      const low = subset.filter((s) => Number.isFinite(s.f[key]) && s.f[key] < lo);
      const high = subset.filter((s) => Number.isFinite(s.f[key]) && s.f[key] >= hi);
      return { low_n: low.length, high_n: high.length, up_low: round(share(low, "ACHAT")), up_high: round(share(high, "ACHAT")), down_low: round(share(low, "VENTE")), down_high: round(share(high, "VENTE")) };
    };
    const t = part(train);
    const v = part(valid);
    // Tiers vides ou trop petits (indicateur presque constant) : aucune conclusion possible.
    const enough = (p) => p.low_n >= MIN_LEAF / 2 && p.high_n >= MIN_LEAF / 2 && p.up_low !== null && p.up_high !== null;
    const dTrain = enough(t) ? t.up_high - t.up_low : null;
    const dValid = enough(v) ? v.up_high - v.up_low : null;
    const predictive = Number.isFinite(dTrain) && Number.isFinite(dValid) && Math.sign(dTrain) === Math.sign(dValid) && Math.abs(dTrain) >= 10 && Math.abs(dValid) >= 10;
    report.push({ key, name, low_below: round(lo, 2), high_from: round(hi, 2), train: t, valid: v, up_diff_train: round(dTrain), up_diff_valid: round(dValid), predictive, direction: predictive ? (dValid > 0 ? "plus haut → plus de hausses" : "plus bas → plus de hausses") : null });
  }
  const strength = (r) => (Number.isFinite(r.up_diff_train) && Number.isFinite(r.up_diff_valid) ? Math.min(Math.abs(r.up_diff_train), Math.abs(r.up_diff_valid)) : -1);
  return report.sort((a, b) => strength(b) - strength(a));
}

// --- Analyse des erreurs de la règle en place sur la période récente : tiers d'indicateur où elle
// se trompe le plus et le moins (au moins MIN_LEAF cas). Sert à la vigilance du verdict du jour.
export function errorAnalysis(valid, call) {
  const total = valid.length;
  const errors = valid.filter((s) => call(s) !== s.actual).length;
  const buckets = [];
  for (const [key, name] of Object.entries(FEATURES)) {
    const vals = valid.map((s) => s.f[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (vals.length < 3 * MIN_LEAF) continue;
    const lo = quantile(vals, 1 / 3);
    const hi = quantile(vals, 2 / 3);
    for (const [label, test] of [["bas", (x) => x < lo], ["haut", (x) => x >= hi]]) {
      const subset = valid.filter((s) => Number.isFinite(s.f[key]) && test(s.f[key]));
      if (subset.length < MIN_LEAF) continue;
      const err = subset.filter((s) => call(s) !== s.actual).length;
      buckets.push({ key, name, zone: label, bound: round(label === "bas" ? lo : hi, 2), n: subset.length, error_pct: round((err / subset.length) * 100) });
    }
  }
  buckets.sort((a, b) => b.error_pct - a.error_pct);
  return { n: total, error_pct: total ? round((errors / total) * 100) : null, worst: buckets.slice(0, 3), best: buckets.slice(-3).reverse() };
}

// Situation du jour dans une zone à erreurs fréquentes de la règle ?
export function riskFlags(f, analysis, overallErrorPct) {
  return ((analysis && analysis.worst) || [])
    .filter((b) => b.error_pct >= overallErrorPct + 10)
    .filter((b) => Number.isFinite(f[b.key]) && (b.zone === "bas" ? f[b.key] < b.bound : f[b.key] >= b.bound))
    .map((b) => `${b.name} ${b.zone === "bas" ? "bas" : "haut"} : la règle s'y est trompée ${b.error_pct} % du temps (${b.n} cas)`);
}

// Confiance : taux de réussite de l'appel sur la période récente, ajusté selon l'élan du bitcoin
// (même rétrécissement que pour les verdicts réels, k = 10).
export function labCalibration(valid, call) {
  const blank = () => ({ n: 0, correct: 0, btc: { hausse: { n: 0, correct: 0 }, baisse: { n: 0, correct: 0 } } });
  const cal = { ACHAT: blank(), ATTENTE: blank(), VENTE: blank() };
  for (const s of valid) {
    const c = cal[call(s)];
    if (!c) continue;
    const ok = call(s) === s.actual;
    c.n += 1;
    if (ok) c.correct += 1;
    if (Number.isFinite(s.f.btc_macd)) {
      const k = c.btc[s.f.btc_macd > 0 ? "hausse" : "baisse"];
      k.n += 1;
      if (ok) k.correct += 1;
    }
  }
  for (const c of Object.values(cal)) c.pct = c.n ? round((c.correct / c.n) * 100, 0) : null;
  return cal;
}

// --- Correction par l'analyse des erreurs (11/10/2026) : la situation de marché du jour est
// résumée par deux indicateurs dont la valeur prédictive a tenu sur les deux périodes du
// laboratoire (élan du bitcoin, peur/cupidité). Pour chaque appel de la règle × situation, si une
// autre issue a été nettement plus fréquente (≥ CORRECTION_MARGIN points, ≥ CORRECTION_MIN_N cas),
// l'appel est corrigé vers elle. Le mécanisme lui-même est validé honnêtement : corrections apprises
// sur la période ancienne, notées sur la période récente qu'elles n'ont jamais vue.
export const CORRECTION_MIN_N = 80;
export const CORRECTION_MARGIN = 10;

export function situationKey(f) {
  const btc = Number.isFinite(f.btc_macd) ? (f.btc_macd > 0 ? "btc_hausse" : "btc_baisse") : "btc_inconnu";
  const fng = Number.isFinite(f.fng) ? (f.fng >= 55 ? "cupidite" : f.fng >= 45 ? "neutre" : "peur") : "fng_inconnu";
  return `${btc}|${fng}`;
}

export const SITUATION_LABELS = { btc_hausse: "bitcoin en élan positif", btc_baisse: "bitcoin en élan négatif", btc_inconnu: "élan du bitcoin inconnu", cupidite: "cupidité (≥ 55)", neutre: "sentiment neutre (45-54)", peur: "peur (< 45)", fng_inconnu: "sentiment inconnu" };
export const describeSituation = (key) => key.split("|").map((k) => SITUATION_LABELS[k] || k).join(", ");

export function learnCorrections(samples, call) {
  const cells = {};
  for (const s of samples) {
    const k = `${call(s)}#${situationKey(s.f)}`;
    const c = (cells[k] = cells[k] || { n: 0, ACHAT: 0, ATTENTE: 0, VENTE: 0 });
    c.n += 1;
    c[s.actual] += 1;
  }
  const corrections = {};
  for (const [k, c] of Object.entries(cells)) {
    if (c.n < CORRECTION_MIN_N) continue;
    const from = k.split("#")[0];
    const best = CLASSES.reduce((a, b) => (c[b] > c[a] ? b : a), from);
    if (best !== from && ((c[best] - c[from]) / c.n) * 100 >= CORRECTION_MARGIN) {
      corrections[k] = { from, to: best, n: c.n, share_from: round((c[from] / c.n) * 100), share_to: round((c[best] / c.n) * 100) };
    }
  }
  return corrections;
}

export function correctedCall(corrections, call, f) {
  const fix = corrections && corrections[`${call}#${situationKey(f)}`];
  return fix ? fix.to : call;
}

export function evaluateCorrections(train, valid, call) {
  const learned = learnCorrections(train, call);
  const fixed = (s) => correctedCall(learned, call(s), s.f);
  return { raw_valid: accuracy(valid, call), corrected_valid: accuracy(valid, fixed), learned_on_train: Object.keys(learned).length };
}

// Confiance d'un appel dans une situation : part des cas récents de cette situation où l'issue a été
// cet appel, rétrécie vers le taux global de l'appel (k = 10) — même principe que pour l'élan BTC.
export function situationConfidence(valid, finalCall, f, rawCallFn, corrections) {
  const final = (s) => correctedCall(corrections, rawCallFn(s), s.f);
  const same = valid.filter((s) => final(s) === finalCall);
  if (same.length < 10) return { pct: null, n: same.length, situation_n: 0 };
  const base = same.filter((s) => s.actual === finalCall).length / same.length;
  const key = situationKey(f);
  const ctx = same.filter((s) => situationKey(s.f) === key);
  const p = (ctx.filter((s) => s.actual === finalCall).length + 10 * base) / (ctx.length + 10);
  return { pct: round(p * 100, 0), n: same.length, situation_n: ctx.length };
}
