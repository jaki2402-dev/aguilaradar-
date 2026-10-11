// Lecture technique quotidienne des 15 favoris → data/technical-favoris.json, lancée par
// .github/workflows/technical-daily.yml (aucun quota Claude, aucun connecteur).
// Pourquoi : les verdicts du moteur ne s'appuyaient que sur les évolutions 24 h / 7 j / 30 j —
// ni tendance de fond, ni RSI, ni MACD (constat du 10/10/2026 : 66 ATTENTE sur 82 verdicts vérifiés
// alors que le marché a fait +5 % ou plus dans 44 cas). Mesures + règles de lecture FIXES et
// documentées, jamais un verdict : le moteur reste seul à émettre ACHAT/ATTENTE/VENTE.
// Mêmes calculs que le site (computeRSI/computeSMA/computeMACD de js/detail.js, chargés tels quels).
// Contient aussi une analyse rétrospective : ce que disaient ces indicateurs le jour de chaque
// verdict vérifié, comparé à l'issue réelle (aucune donnée postérieure à l'émission n'est utilisée).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const OUT_PATH = "data/technical-favoris.json";
const DAY_MS = 86400000;

// Charge js/config.js (FAVORIS) et js/detail.js (calculs) dans un contexte isolé : une seule
// implémentation des indicateurs pour le site et le robot.
export function loadSite(root = new URL("..", import.meta.url)) {
  const ctx = {};
  vm.createContext(ctx);
  for (const file of ["js/config.js", "js/detail.js"]) vm.runInContext(readFileSync(new URL(file, root), "utf-8"), ctx);
  vm.runInContext("globalThis.__site = { FAVORIS, computeRSI, computeSMA, computeMACD };", ctx);
  return ctx.__site;
}

const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
// Cours et moyennes : 6 chiffres significatifs (BTC à 80 000 $ comme PEAQ à 0,05 $).
const sig = (v) => (Number.isFinite(v) ? Number(v.toPrecision(6)) : null);
const pctChange = (now, before) => (Number.isFinite(now) && Number.isFinite(before) && before > 0 ? (now / before - 1) * 100 : null);

// Indicateurs au DERNIER point de `closes` (clôtures quotidiennes, plus ancienne en premier).
export function indicatorsAt(closes, site) {
  const n = closes.length;
  if (n < 15) return null;
  const price = closes[n - 1];
  const sma50 = site.computeSMA(closes, 50);
  const sma200 = site.computeSMA(closes, 200);
  const macd = site.computeMACD(closes);
  const ago = (days) => (n - 1 - days >= 0 ? closes[n - 1 - days] : null);
  const returns = [];
  for (let i = Math.max(1, n - 30); i < n; i++) returns.push(closes[i] / closes[i - 1] - 1);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1));
  const high365 = Math.max(...closes.slice(-365));
  return {
    price_usd: sig(price),
    rsi14: round(site.computeRSI(closes, 14), 1),
    sma50: sig(sma50),
    sma200: sig(sma200),
    sma200_gap_pct: sma200 ? round(pctChange(price, sma200), 1) : null,
    sma50_above_sma200: sma50 && sma200 ? sma50 > sma200 : null,
    macd_histogram: macd ? sig(macd.histogram) : null,
    change_pct: { "7d": round(pctChange(price, ago(7)), 1), "30d": round(pctChange(price, ago(30)), 1), "90d": round(pctChange(price, ago(90)), 1), "365d": round(pctChange(price, ago(365)), 1) },
    volatility_30d_pct: returns.length >= 20 ? round(sd * Math.sqrt(365) * 100, 0) : null,
    drawdown_from_365d_high_pct: round(pctChange(price, high365), 1),
  };
}

// Valorisation (méthodologie §4) : capitalisation / volume d'échange moyen sur 30 j, comparé à SA
// propre fourchette sur 1 an (jamais à un autre actif). Ratio bas = la capitalisation est faible
// au regard de l'activité réelle (attractif) ; haut = chère. percentile = part des jours de l'année
// où le ratio était plus bas qu'aujourd'hui. Score 0-10 : premier tiers → 7-10, tiers médian → 4-6,
// dernier tiers → 0-3. Mesure de type « NVT » sur le volume d'échange : un indice, pas une vérité.
export function valuationSeries(marketCaps, volumes) {
  const volByDay = new Map(volumes.map((p) => [Math.floor(p[0] / DAY_MS), p[1]]));
  const days = marketCaps.map((p) => [Math.floor(p[0] / DAY_MS), p[1]]);
  const out = [];
  for (let i = 0; i < days.length; i++) {
    const window = [];
    for (let d = days[i][0] - 29; d <= days[i][0]; d++) if (volByDay.has(d)) window.push(volByDay.get(d));
    if (window.length < 20) continue;
    const avgVol = window.reduce((a, b) => a + b, 0) / window.length;
    if (avgVol > 0) out.push({ day: days[i][0], ratio: days[i][1] / avgVol });
  }
  return out;
}

export function valuationAt(series, untilMs = Infinity) {
  const known = series.filter((p) => p.day * DAY_MS <= untilMs);
  if (known.length < 120) return null; // moins de 4 mois d'historique : pas de fourchette fiable
  const today = known[known.length - 1].ratio;
  const below = known.filter((p) => p.ratio < today).length;
  const percentile = below / (known.length - 1);
  return { ratio: round(today, 1), percentile: round(percentile * 100, 0), score: Math.round((1 - percentile) * 10), days: known.length };
}

// Lecture en une phrase, par règles fixes (seuils RSI 70 / 30 identiques au reste du site).
export function readingOf(ind) {
  if (!ind) return null;
  const parts = [];
  if (ind.sma200_gap_pct !== null) {
    const gap = `${ind.sma200_gap_pct > 0 ? "+" : ""}${Math.round(ind.sma200_gap_pct)} %`;
    parts.push(`Tendance de fond ${ind.sma200_gap_pct >= 0 ? "haussière" : "baissière"} (${gap} vs moyenne 200 j)`);
  }
  if (ind.macd_histogram !== null && ind.macd_histogram !== 0) parts.push(`élan ${ind.macd_histogram > 0 ? "positif" : "négatif"}`);
  let rsi = "";
  if (ind.rsi14 !== null) {
    rsi = ind.rsi14 >= 70 ? `RSI ${Math.round(ind.rsi14)} : surachat, mouvement étiré` : ind.rsi14 <= 30 ? `RSI ${Math.round(ind.rsi14)} : survente` : `RSI ${Math.round(ind.rsi14)} neutre`;
  }
  const head = parts.join(", ");
  const text = [head, rsi].filter(Boolean).join(" ; ");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : null;
}

// Clôtures connues AU MOMENT de `iso` (points datés au plus tard à cet instant) — jamais après.
export function closesUntil(points, iso) {
  const t = Date.parse(iso);
  return points.filter((p) => p[0] <= t).map((p) => p[1]);
}

const DIRECTIONS = ["ACHAT", "ATTENTE", "VENTE"];

// Règles candidates pour corriger le moteur (P14), FIGÉES le 11/10/2026 avant de connaître l'issue
// des 15 verdicts alors en attente : leur score sur les verdicts vérifiés après REGISTERED_AT est
// un vrai test (impossible de les ajuster après coup). Ne jamais modifier une règle existante :
// en ajouter une nouvelle, avec sa propre date. Mêmes seuils RSI que le site (70 / 30).
export const RULES_REGISTERED_AT = "2026-10-11T09:00:00Z";
export const CANDIDATE_RULES = {
  moteur: { name: "Moteur actuel", label: "Le verdict émis, tel quel", call: (v) => v.verdict },
  garde_fou_rsi: {
    name: "Moteur + garde-fou RSI",
    label: "Moteur + garde-fou RSI : ACHAT → ATTENTE si RSI ≥ 70, VENTE → ATTENTE si RSI ≤ 30",
    call: (v, ind) => (v.verdict === "ACHAT" && ind.rsi14 >= 70 ? "ATTENTE" : v.verdict === "VENTE" && ind.rsi14 <= 30 ? "ATTENTE" : v.verdict),
  },
  tendance_rsi: {
    name: "Tendance + RSI",
    label: "Tendance + RSI : ACHAT si cours > MM200 et RSI < 70 ; VENTE si cours < MM200 et MACD négatif ; sinon ATTENTE",
    call: (v, ind) => (ind.sma200_gap_pct >= 0 && ind.rsi14 < 70 ? "ACHAT" : ind.sma200_gap_pct < 0 && ind.macd_histogram !== null && ind.macd_histogram < 0 ? "VENTE" : "ATTENTE"),
  },
  toujours_achat: { name: "Toujours ACHAT (référence)", label: "Référence naïve à battre : ACHAT à chaque fois", call: () => "ACHAT" },
  // Ajoutée le 11/10/2026 10h (demande de l'utilisateur : des verdicts utiles, pas « ATTENTE » en
  // permanence) et adoptée comme règle de décision du moteur (ENGINE_RULE). Choisie sur les 82
  // verdicts vérifiés : 57 % de justes contre 26 % pour le moteur, meilleure sur les deux moitiés
  // de la période (39 % / 76 % contre 29 % / 22 %). Les lectures technique « baissier » de la routine
  // avaient été suivies d'une hausse 10 fois sur 10 : marché de retour à la moyenne sur 1-2 semaines.
  retour_moyenne_rsi: {
    name: "Retour à la moyenne (RSI)",
    label: "VENTE si RSI ≥ 70 (hausse étirée), sinon ACHAT — règle du moteur depuis le 11/10/2026",
    registered_at: "2026-10-11T10:00:00Z",
    standalone: true,
    call: (v, ind) => (ind.rsi14 >= 70 ? "VENTE" : "ACHAT"),
  },
  // Ajoutées le 11/10/2026 13h avec l'auto-sélection : elles utilisent aussi l'état du bitcoin le
  // jour du verdict (market). Diversité voulue : retour à la moyenne (marché en dents de scie) ET
  // suivi de tendance (marché directionnel), pour que la sélection puisse suivre un changement.
  retour_moyenne_marche: {
    name: "Retour à la moyenne + marché",
    label: "VENTE si RSI ≥ 70, ou si l'actif et le bitcoin ont tous deux un élan positif avec RSI ≥ 60 ; sinon ACHAT",
    registered_at: "2026-10-11T13:00:00Z",
    standalone: true,
    call: (v, ind, m) => (ind.rsi14 >= 70 || (ind.rsi14 >= 60 && ind.macd_histogram > 0 && m && m.macd_histogram > 0) ? "VENTE" : "ACHAT"),
  },
  tendance_pure: {
    name: "Suivi de tendance",
    label: "ACHAT si le cours est au-dessus de sa moyenne 200 j, VENTE en dessous",
    registered_at: "2026-10-11T13:00:00Z",
    standalone: true,
    call: (v, ind) => (ind.sma200_gap_pct >= 0 ? "ACHAT" : "VENTE"),
  },
  marche_baissier_protege: {
    name: "Retour à la moyenne protégé",
    label: "VENTE si RSI ≥ 70, ou si le bitcoin est sous sa moyenne 200 j avec un élan négatif et RSI ≥ 45 ; sinon ACHAT",
    registered_at: "2026-10-11T13:00:00Z",
    standalone: true,
    call: (v, ind, m) => (ind.rsi14 >= 70 || (m && m.sma200_gap_pct !== null && m.sma200_gap_pct < 0 && m.macd_histogram !== null && m.macd_histogram < 0 && ind.rsi14 >= 45) ? "VENTE" : "ACHAT"),
  },
};
CANDIDATE_RULES.tendance_rsi.standalone = true;

// Règle par défaut du moteur (docs/routines/cycle-2h-verdict.md §2) ; l'auto-sélection peut en
// changer (selectEngineRule).
export const ENGINE_RULE = "retour_moyenne_rsi";

// Auto-correction : chaque soir, chaque règle autonome est rejouée sur les SELECTION_WINDOW derniers
// verdicts vérifiés (indicateurs connus le jour de l'émission). La règle en place n'est remplacée
// que si une autre fait mieux d'au moins SELECTION_MARGIN_PTS points, sur au moins
// SELECTION_MIN_N verdicts. Réglages testés le 11/10 sur l'historique : fenêtre 20 sans marge →
// changements à contretemps (51 % au lieu de 57 %) ; fenêtre 30 + marge 5 → aucun faux changement.
export const SELECTION_WINDOW = 30;
export const SELECTION_MARGIN_PTS = 5;
export const SELECTION_MIN_N = 20;

export function selectEngineRule(currentId, rows) {
  const current = CANDIDATE_RULES[currentId] && CANDIDATE_RULES[currentId].standalone ? currentId : ENGINE_RULE;
  const usable = rows
    .filter(({ ind }) => ind.rsi14 !== null && ind.sma200_gap_pct !== null)
    .sort((a, b) => (a.v.outcome.resolved_at || "").localeCompare(b.v.outcome.resolved_at || ""))
    .slice(-SELECTION_WINDOW);
  const scores = {};
  for (const [key, rule] of Object.entries(CANDIDATE_RULES)) {
    if (!rule.standalone) continue;
    const correct = usable.filter(({ v, ind, market }) => rule.call(v, ind, market) === v.outcome.actual_direction).length;
    scores[key] = usable.length ? round((correct / usable.length) * 100, 1) : null;
  }
  let id = current;
  if (usable.length >= SELECTION_MIN_N) {
    const best = Object.keys(scores).reduce((a, b) => (scores[b] > scores[a] ? b : a), current);
    if (best !== current && scores[best] - scores[current] >= SELECTION_MARGIN_PTS) id = best;
  }
  return { id, switched: id !== current, from: current, window_n: usable.length, scores };
}

// Score de chaque règle sur les mêmes verdicts (ceux dont RSI et MM200 sont connus à l'émission),
// séparé entre rétrospectif (issue connue à la date de la règle) et test réel (issue postérieure).
export function scoreRules(rows) {
  const usable = rows.filter(({ ind }) => ind.rsi14 !== null && ind.sma200_gap_pct !== null);
  const score = (subset) => {
    const results = {};
    for (const [key, rule] of Object.entries(CANDIDATE_RULES)) {
      const correct = subset.filter(({ v, ind, market }) => rule.call(v, ind, market) === v.outcome.actual_direction).length;
      results[key] = { correct, pct: subset.length ? round((correct / subset.length) * 100, 1) : null };
    }
    return { n: subset.length, results };
  };
  // Chaque règle a sa propre date : seules les issues connues après elle comptent comme test réel.
  const split = (after) => {
    const out = { n: 0, results: {} };
    for (const [key, rule] of Object.entries(CANDIDATE_RULES)) {
      const since = rule.registered_at || RULES_REGISTERED_AT;
      const subset = usable.filter((r) => ((r.v.outcome.resolved_at || "") >= since) === after);
      const one = score(subset);
      out.results[key] = { n: one.n, ...one.results[key] };
      if (key === "moteur") out.n = one.n;
    }
    return out;
  };
  return {
    registered_at: RULES_REGISTERED_AT,
    definitions: Object.fromEntries(Object.entries(CANDIDATE_RULES).map(([k, r]) => [k, { name: r.name, rule: r.label, registered_at: r.registered_at || RULES_REGISTERED_AT }])),
    retrospective: split(false),
    prospective: split(true),
  };
}

function bucket() {
  return { n: 0, engine_correct: 0, actual: { ACHAT: 0, ATTENTE: 0, VENTE: 0 } };
}

function add(b, v) {
  b.n += 1;
  if (v.outcome.verdict_correct === true) b.engine_correct += 1;
  if (DIRECTIONS.includes(v.outcome.actual_direction)) b.actual[v.outcome.actual_direction] += 1;
}

// Analyse rétrospective des verdicts vérifiés : indicateurs au jour d'émission vs issue réelle.
// « Règle de tendance » = ACHAT si le cours était au-dessus de sa moyenne 200 j, VENTE sinon —
// une référence simple pour situer le moteur, pas une règle à appliquer telle quelle.
export function backtest(verdicts, pointsByCgId, site, valuationByCgId = {}) {
  const rows = [];
  for (const v of verdicts || []) {
    if (v.status !== "resolved" || !v.outcome || !DIRECTIONS.includes(v.outcome.actual_direction)) continue;
    const points = pointsByCgId[v.asset];
    if (!points) continue;
    const ind = indicatorsAt(closesUntil(points, v.issued_at), site);
    if (!ind) continue;
    // État du marché (bitcoin) le même jour, mêmes cours connus seulement.
    const market = pointsByCgId.bitcoin ? indicatorsAt(closesUntil(pointsByCgId.bitcoin, v.issued_at), site) : null;
    const val = valuationByCgId[v.asset] ? valuationAt(valuationByCgId[v.asset], Date.parse(v.issued_at)) : null;
    rows.push({ v, ind, market, val });
  }
  const byRsi = { surachat: bucket(), neutre: bucket(), survente: bucket() };
  const byTrend = { au_dessus_mm200: bucket(), en_dessous_mm200: bucket() };
  let trendRuleN = 0;
  let trendRuleCorrect = 0;
  let engineN = 0;
  let engineCorrect = 0;
  const engineCalls = { ACHAT: { n: 0, correct: 0 }, ATTENTE: { n: 0, correct: 0 }, VENTE: { n: 0, correct: 0 } };
  const actual = { ACHAT: 0, ATTENTE: 0, VENTE: 0 };
  for (const { v, ind } of rows) {
    engineN += 1;
    if (v.outcome.verdict_correct === true) engineCorrect += 1;
    actual[v.outcome.actual_direction] += 1;
    if (engineCalls[v.verdict]) {
      engineCalls[v.verdict].n += 1;
      if (v.outcome.verdict_correct === true) engineCalls[v.verdict].correct += 1;
    }
    if (ind.rsi14 !== null) add(byRsi[ind.rsi14 >= 70 ? "surachat" : ind.rsi14 <= 30 ? "survente" : "neutre"], v);
    if (ind.sma200_gap_pct !== null) {
      const above = ind.sma200_gap_pct >= 0;
      add(byTrend[above ? "au_dessus_mm200" : "en_dessous_mm200"], v);
      trendRuleN += 1;
      if ((above ? "ACHAT" : "VENTE") === v.outcome.actual_direction) trendRuleCorrect += 1;
    }
  }
  const pct = (a, b) => (b ? round((a / b) * 100, 1) : null);
  return {
    sample: rows.length,
    first_issued_at: rows.length ? rows.map((r) => r.v.issued_at).sort()[0] : null,
    engine_accuracy_pct: pct(engineCorrect, engineN),
    engine_calls: engineCalls,
    actual,
    trend_rule: { n: trendRuleN, accuracy_pct: pct(trendRuleCorrect, trendRuleN) },
    by_rsi_zone: byRsi,
    by_trend: byTrend,
    rules: scoreRules(rows),
    _rows: rows, // usage interne (sélection de règle), retiré avant écriture
    // Détail par verdict (indicateurs au jour d'émission + issue) : rend chaque chiffre ci-dessus
    // vérifiable et permet d'étudier une règle sans refaire tourner le robot.
    rows: rows.map(({ v, ind, market, val }) => ({
      id: v.id,
      issued_at: v.issued_at,
      verdict: v.verdict,
      actual: v.outcome.actual_direction,
      move_pct: v.outcome.actual_move_pct ?? null,
      horizon_days: v.horizon_days ?? null,
      rsi14: ind.rsi14,
      sma200_gap_pct: ind.sma200_gap_pct,
      sma50_above_sma200: ind.sma50_above_sma200,
      macd_histogram: ind.macd_histogram,
      change_7d: ind.change_pct["7d"],
      change_30d: ind.change_pct["30d"],
      change_90d: ind.change_pct["90d"],
      volatility_30d_pct: ind.volatility_30d_pct,
      drawdown_pct: ind.drawdown_from_365d_high_pct,
      btc_sma200_gap_pct: market ? market.sma200_gap_pct : null,
      btc_macd_histogram: market ? market.macd_histogram : null,
      btc_change_30d: market ? market.change_pct["30d"] : null,
      valuation_percentile: val ? val.percentile : null,
    })),
    note: "Rétrospectif, petit échantillon, période majoritairement haussière : un indice pour orienter l'auto-correction du moteur, pas une preuve.",
  };
}

// Verdict proposé par la règle du moteur pour un favori aujourd'hui, avec une confiance MESURÉE :
// taux de réussite de ce même appel sur tous les verdicts vérifiés, ajusté selon l'élan du bitcoin
// le jour du verdict (rétrécissement vers le taux global, poids CONFIDENCE_SHRINK). Testé le 11/10
// hors échantillon (données antérieures seulement) : erreur de Brier 0,279 contre 0,300 sans ce
// contexte ; l'élan de l'actif ou la zone de RSI n'amélioraient rien. Sans RSI : ATTENTE.
const CONFIDENCE_SHRINK = 10;
const btcContext = (market) => (market && market.macd_histogram !== null ? (market.macd_histogram > 0 ? "hausse" : "baisse") : null);

export function engineCalibration(rows, ruleKey = ENGINE_RULE) {
  const rule = CANDIDATE_RULES[ruleKey];
  const blank = () => ({ n: 0, correct: 0, pct: null, btc: { hausse: { n: 0, correct: 0 }, baisse: { n: 0, correct: 0 } } });
  const cal = { ACHAT: blank(), ATTENTE: blank(), VENTE: blank() };
  for (const { v, ind, market } of rows) {
    if (ind.rsi14 === null || ind.sma200_gap_pct === null) continue;
    const call = rule.call(v, ind, market);
    const c = cal[call];
    if (!c) continue;
    const ok = call === v.outcome.actual_direction;
    c.n += 1;
    if (ok) c.correct += 1;
    const ctx = btcContext(market);
    if (ctx) {
      c.btc[ctx].n += 1;
      if (ok) c.btc[ctx].correct += 1;
    }
  }
  for (const c of Object.values(cal)) c.pct = c.n ? round((c.correct / c.n) * 100, 0) : null;
  return cal;
}

export function contextConfidence(cal, call, market) {
  const c = cal && cal[call];
  if (!c || c.n < 10) return null;
  const base = c.correct / c.n;
  const ctx = btcContext(market);
  if (!ctx) return round(base * 100, 0);
  const k = c.btc[ctx];
  return round(((k.correct + CONFIDENCE_SHRINK * base) / (k.n + CONFIDENCE_SHRINK)) * 100, 0);
}

const BASIS = {
  retour_moyenne_rsi: (verdict, ind) => (verdict === "VENTE" ? `RSI ${Math.round(ind.rsi14)} ≥ 70 : hausse étirée, repli plus fréquent ensuite` : `RSI ${Math.round(ind.rsi14)} < 70 : pas d'excès, rebond ou poursuite plus fréquents que la stabilité`),
};

export function proposedVerdict(ind, calibration, ruleKey = ENGINE_RULE, market = null) {
  if (!ind || ind.rsi14 === null || ind.sma200_gap_pct === null) return { rule: ruleKey, verdict: "ATTENTE", confidence_pct: null, sample_n: 0, basis: "Indicateurs indisponibles : pas de lecture fiable" };
  const rule = CANDIDATE_RULES[ruleKey];
  const verdict = rule.call(null, ind, market);
  const c = calibration && calibration[verdict];
  const ctx = btcContext(market);
  const describe = BASIS[ruleKey] || ((vd) => `${rule.name} : ${vd}`);
  return {
    rule: ruleKey,
    verdict,
    confidence_pct: contextConfidence(calibration, verdict, market),
    sample_n: c ? c.n : 0,
    context: ctx ? `élan du bitcoin ${ctx === "hausse" ? "positif" : "négatif"}` : null,
    context_n: c && ctx ? c.btc[ctx].n : 0,
    basis: describe(verdict, ind),
  };
}

// ---------------------------------------------------------------------------------------------
// Alertes techniques (data/alerts.json, type "signal_technique") : uniquement une BASCULE entre la
// lecture d'hier et celle d'aujourd'hui, jamais un état qui dure. Chaque alerte = 1 notification
// push (Worker) : au plus MAX_TECH_ALERTS par passage, et pas deux fois la même bascule pour un
// actif en ALERT_COOLDOWN_DAYS jours (un RSI qui oscille autour de 70 ne sonne pas tous les jours).
const ALERTS_PATH = "data/alerts.json";
const MAX_TECH_ALERTS = 3;
const ALERT_COOLDOWN_DAYS = 7;
const PREVIOUS_MAX_AGE_MS = 3 * DAY_MS; // lecture précédente trop ancienne (panne) : pas de comparaison

export function technicalEvents(previous, current) {
  const events = [];
  for (const [ticker, now] of Object.entries(current || {})) {
    const before = previous && previous[ticker];
    if (!before || !now) continue;
    const fin = Number.isFinite;
    if (fin(before.sma200_gap_pct) && fin(now.sma200_gap_pct)) {
      if (before.sma200_gap_pct >= 0 && now.sma200_gap_pct < 0) events.push({ ticker, kind: "mm200_dessous", priority: 0, now });
      if (before.sma200_gap_pct < 0 && now.sma200_gap_pct >= 0) events.push({ ticker, kind: "mm200_dessus", priority: 0, now });
    }
    if (fin(before.rsi14) && fin(now.rsi14)) {
      if (before.rsi14 < 70 && now.rsi14 >= 70) events.push({ ticker, kind: "rsi_surachat", priority: 1, now });
      if (before.rsi14 > 30 && now.rsi14 <= 30) events.push({ ticker, kind: "rsi_survente", priority: 1, now });
    }
  }
  return events.sort((a, b) => a.priority - b.priority);
}

const signedInt = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))} %`;

function alertText(e) {
  const n = e.now;
  const trend = Number.isFinite(n.sma200_gap_pct) ? ` Tendance de fond : ${signedInt(n.sma200_gap_pct)} vs moyenne 200 j.` : "";
  const tail = " Mesure automatique sur les cours, pas un conseil.";
  switch (e.kind) {
    case "mm200_dessous":
      return { sentiment: "négatif", message: `${e.ticker} passe sous sa moyenne 200 jours (${signedInt(n.sma200_gap_pct)}) : la tendance de fond devient baissière.${tail}` };
    case "mm200_dessus":
      return { sentiment: "positif", message: `${e.ticker} repasse au-dessus de sa moyenne 200 jours (${signedInt(n.sma200_gap_pct)}) : la tendance de fond redevient haussière.${tail}` };
    case "rsi_surachat":
      return { sentiment: "neutre", message: `${e.ticker} entre en zone de surachat (RSI 14 j à ${Math.round(n.rsi14)}) : hausse déjà étirée, le risque de repli augmente.${trend}${tail}` };
    default:
      return { sentiment: "neutre", message: `${e.ticker} entre en zone de survente (RSI 14 j à ${Math.round(n.rsi14)}) : forte baisse récente, un rebond est possible sans être garanti.${trend}${tail}` };
  }
}

export function buildTechnicalAlerts(events, alerts, nowIso) {
  const cutoff = new Date(Date.parse(nowIso) - ALERT_COOLDOWN_DAYS * DAY_MS).toISOString();
  const recent = new Set((alerts || []).filter((a) => a.type === "signal_technique" && (a.triggered_at || "") >= cutoff).map((a) => `${a.ticker_ou_theme}|${a.signal_kind}`));
  const usedIds = new Set((alerts || []).map((a) => a.id));
  const out = [];
  for (const e of events) {
    if (out.length >= MAX_TECH_ALERTS) break;
    const id = `alert-${nowIso.slice(0, 10).replace(/-/g, "")}-${e.ticker.toLowerCase()}-${e.kind.replace(/_/g, "-")}`;
    if (recent.has(`${e.ticker}|${e.kind}`) || usedIds.has(id)) continue;
    usedIds.add(id);
    out.push({
      id,
      ticker_ou_theme: e.ticker,
      type: "signal_technique",
      signal_kind: e.kind,
      triggered_at: nowIso,
      ...alertText(e),
      source: "Calcul automatique (GitHub Action technical-daily) : lecture technique du jour comparée à celle de la veille, historique CoinGecko",
    });
  }
  return out;
}

async function fetchSeries(cgId, attempt = 1) {
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=365&interval=daily`, { headers: { accept: "application/json" } });
  if (res.status === 429 && attempt === 1) {
    await new Promise((r) => setTimeout(r, 65000));
    return fetchSeries(cgId, 2);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const valid = (arr) => (arr || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0);
  const points = valid(body.prices);
  if (points.length < 30) throw new Error(`historique trop court (${points.length} points)`);
  return { points, marketCaps: valid(body.market_caps), volumes: valid(body.total_volumes) };
}

// Offre et valorisation diluée des 15 favoris en UN appel (/coins/markets) — remplace l'appel que
// le navigateur faisait au chargement et qui échouait souvent (limite CoinGecko) : la ligne
// Tokenomics de la fiche restait alors « Donnée insuffisante ».
async function fetchSupply(ids) {
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(",")}&per_page=50`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = {};
  for (const c of await res.json()) {
    const num = (v) => (Number.isFinite(v) && v > 0 ? v : null);
    out[c.id] = { market_cap_usd: num(c.market_cap), fdv_usd: num(c.fully_diluted_valuation), circulating_supply: num(c.circulating_supply), total_supply: num(c.total_supply), max_supply: num(c.max_supply), volume_24h_usd: num(c.total_volume) };
  }
  return out;
}

async function main() {
  const site = loadSite();
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(OUT_PATH, "utf-8"));
  } catch {
    previous = null; // premier passage : rien à comparer
  }
  const out = { updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), currency: "USD", source: "CoinGecko /coins/{id}/market_chart (365 j, quotidien) — calculs de js/detail.js", assets: {}, backtest: null, errors: [] };
  const pointsByCgId = {};
  const valuationByCgId = {};
  for (const fav of site.FAVORIS) {
    try {
      const series = await fetchSeries(fav.cgId);
      const points = series.points;
      pointsByCgId[fav.cgId] = points;
      valuationByCgId[fav.cgId] = valuationSeries(series.marketCaps, series.volumes);
      const ind = indicatorsAt(points.map((p) => p[1]), site);
      out.assets[fav.ticker] = { ...ind, reading: readingOf(ind), valuation: valuationAt(valuationByCgId[fav.cgId]), as_of: new Date(points[points.length - 1][0]).toISOString().replace(/\.\d{3}Z$/, "Z") };
    } catch (e) {
      out.errors.push(`${fav.ticker} : ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 7000)); // API publique : rester sous ~10 appels/min
  }
  if (Object.keys(out.assets).length === 0) {
    console.error("Aucun favori calculé, fichier laissé tel quel :", out.errors.join(" ; "));
    process.exitCode = 1;
    return;
  }
  try {
    out.backtest = backtest(JSON.parse(readFileSync("data/verdicts.json", "utf-8")), pointsByCgId, site, valuationByCgId);
  } catch (e) {
    out.errors.push(`backtest : ${e.message}`);
  }
  // Offre (Tokenomics de la fiche) : étape à part, son échec n'empêche rien d'autre.
  try {
    const supply = await fetchSupply(site.FAVORIS.map((f) => f.cgId));
    for (const fav of site.FAVORIS) if (out.assets[fav.ticker] && supply[fav.cgId]) out.assets[fav.ticker].supply = supply[fav.cgId];
  } catch (e) {
    out.errors.push(`offre : ${e.message}`);
  }
  // Auto-correction : règle du moteur choisie sur les derniers verdicts vérifiés, puis verdict
  // proposé par favori avec sa confiance mesurée (lu par le cycle des verdicts, spec §2).
  const rows = out.backtest ? out.backtest._rows : [];
  if (out.backtest) delete out.backtest._rows;
  const prevRule = previous && previous.engine_rule ? previous.engine_rule : null;
  const selection = selectEngineRule(prevRule ? prevRule.id : ENGINE_RULE, rows);
  const history = prevRule && Array.isArray(prevRule.history) ? prevRule.history : [];
  if (selection.switched) history.push({ at: out.updated_at, from: selection.from, to: selection.id, window_n: selection.window_n, scores: selection.scores });
  const calibration = engineCalibration(rows, selection.id);
  const rule = CANDIDATE_RULES[selection.id];
  out.engine_rule = {
    id: selection.id,
    name: rule.name,
    rule: rule.label,
    since: selection.switched ? out.updated_at : (prevRule && prevRule.id === selection.id && prevRule.since) || rule.registered_at || RULES_REGISTERED_AT,
    selection: { window: SELECTION_WINDOW, margin_pts: SELECTION_MARGIN_PTS, window_n: selection.window_n, scores: selection.scores },
    calibration,
    history,
  };
  const btc = out.assets.BTC || null;
  for (const a of Object.values(out.assets)) a.proposed_verdict = proposedVerdict(a, calibration, selection.id, btc);
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  // Alertes : étape à part, son échec ne touche pas le fichier d'analyse déjà écrit.
  try {
    const fresh = previous && previous.updated_at && Date.parse(out.updated_at) - Date.parse(previous.updated_at) <= PREVIOUS_MAX_AGE_MS;
    if (fresh) {
      const alerts = JSON.parse(readFileSync(ALERTS_PATH, "utf-8"));
      const added = buildTechnicalAlerts(technicalEvents(previous.assets, out.assets), alerts, out.updated_at);
      if (added.length) {
        writeFileSync(ALERTS_PATH, JSON.stringify([...alerts, ...added], null, 2) + "\n");
        console.log(`${added.length} alerte(s) technique(s) : ${added.map((a) => a.id).join(", ")}`);
      }
    }
  } catch (e) {
    console.error(`alertes techniques : ${e.message}`);
  }
  console.log(`${Object.keys(out.assets).length}/15 favoris calculés ; rétrospectif sur ${out.backtest ? out.backtest.sample : 0} verdicts`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
