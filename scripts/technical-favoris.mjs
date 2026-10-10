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
    note: "Rétrospectif, petit échantillon, période majoritairement haussière : un indice pour orienter l'auto-correction du moteur, pas une preuve.",
  };
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
  console.log(`${Object.keys(out.assets).length}/15 favoris calculés ; rétrospectif sur ${out.backtest ? out.backtest.sample : 0} verdicts`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
