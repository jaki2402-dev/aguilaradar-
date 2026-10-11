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
};

// Score de chaque règle sur les mêmes verdicts (ceux dont RSI et MM200 sont connus à l'émission),
// séparé entre rétrospectif (issue connue à la date de la règle) et test réel (issue postérieure).
export function scoreRules(rows) {
  const usable = rows.filter(({ ind }) => ind.rsi14 !== null && ind.sma200_gap_pct !== null);
  const score = (subset) => {
    const results = {};
    for (const [key, rule] of Object.entries(CANDIDATE_RULES)) {
      const correct = subset.filter(({ v, ind }) => rule.call(v, ind) === v.outcome.actual_direction).length;
      results[key] = { correct, pct: subset.length ? round((correct / subset.length) * 100, 1) : null };
    }
    return { n: subset.length, results };
  };
  const after = (r) => (r.v.outcome.resolved_at || "") >= RULES_REGISTERED_AT;
  return {
    registered_at: RULES_REGISTERED_AT,
    definitions: Object.fromEntries(Object.entries(CANDIDATE_RULES).map(([k, r]) => [k, { name: r.name, rule: r.label }])),
    retrospective: score(usable.filter((r) => !after(r))),
    prospective: score(usable.filter(after)),
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
export function backtest(verdicts, pointsByCgId, site) {
  const rows = [];
  for (const v of verdicts || []) {
    if (v.status !== "resolved" || !v.outcome || !DIRECTIONS.includes(v.outcome.actual_direction)) continue;
    const points = pointsByCgId[v.asset];
    if (!points) continue;
    const ind = indicatorsAt(closesUntil(points, v.issued_at), site);
    if (!ind) continue;
    rows.push({ v, ind });
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
    // Détail par verdict (indicateurs au jour d'émission + issue) : rend chaque chiffre ci-dessus
    // vérifiable et permet d'étudier une règle sans refaire tourner le robot.
    rows: rows.map(({ v, ind }) => ({
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
    })),
    note: "Rétrospectif, petit échantillon, période majoritairement haussière : un indice pour orienter l'auto-correction du moteur, pas une preuve.",
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
  const points = (body.prices || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0);
  if (points.length < 30) throw new Error(`historique trop court (${points.length} points)`);
  return points;
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
  for (const fav of site.FAVORIS) {
    try {
      const points = await fetchSeries(fav.cgId);
      pointsByCgId[fav.cgId] = points;
      const ind = indicatorsAt(points.map((p) => p[1]), site);
      out.assets[fav.ticker] = { ...ind, reading: readingOf(ind), as_of: new Date(points[points.length - 1][0]).toISOString().replace(/\.\d{3}Z$/, "Z") };
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
    out.backtest = backtest(JSON.parse(readFileSync("data/verdicts.json", "utf-8")), pointsByCgId, site);
  } catch (e) {
    out.errors.push(`backtest : ${e.message}`);
  }
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
