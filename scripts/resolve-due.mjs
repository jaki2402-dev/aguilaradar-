// Vérification des échéances par robot, lancée par .github/workflows/resolve-due.yml (toutes les
// heures, aucun quota Claude, aucun connecteur). Pur calcul : un prix réel CoinGecko à une date
// donnée, comparé au prix de départ. Reprend trois tâches qui consommaient du quota Claude :
// - verdicts échus (data/verdicts.json, auparavant §5 du cycle) : prix à l'heure EXACTE de
//   resolves_at (le cycle prenait le prix au moment de son passage, jusqu'à 8 h plus tard), puis
//   global_stats (engine-history.json) recalculé avec le calcul du site ;
// - horizons des opportunités (data/opportunities.json, auparavant routine horizons-6h) : même
//   méthode que la routine (prix EUR du jour de check_at, endpoint /history), rien de changé ;
// - groupe témoin (data/control-group.json) : échéances qu'aucune spec ne faisait plus résoudre.
// Jamais d'issue inventée : sans prix fiable, l'échéance reste "pending" pour le passage suivant.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const API = "https://api.coingecko.com/api/v3";
const HOUR_MS = 3600000;
const PRICE_WINDOW_MS = 2 * HOUR_MS; // point le plus proche de l'échéance, à 2 h au plus
const MAX_PER_RUN = 12; // appels de prix par passage (le reste attend l'heure suivante)

// Créneaux où une routine Claude écrit le même fichier : le robot n'y touche pas (pas de conflit
// git en pleine fusion d'une routine). Heures UTC.
const QUIET_WINDOWS = [
  { file: "verdicts", hours: [0, 8, 16], from: 10, to: 45 }, // cycle des verdicts (xxh15)
  { file: "opportunities", hours: [4], from: 0, to: 25 }, // criblage des opportunités (04h00)
  { file: "opportunities", hours: [6], from: 30, to: 50 }, // routine horizons (06h35), tant qu'elle existe
  { file: "control", hours: [9], from: 0, to: 25, weekday: 0 }, // groupe témoin (dimanche 09h00)
];

export function isQuiet(file, now) {
  return QUIET_WINDOWS.some(
    (w) => w.file === file && w.hours.includes(now.getUTCHours()) && now.getUTCMinutes() >= w.from && now.getUTCMinutes() < w.to && (w.weekday === undefined || w.weekday === now.getUTCDay())
  );
}

// Une seule règle « juste / faux » pour le site et le robot : classifyActualMove et
// computeEngineStats de js/engine.js, chargés tels quels.
export function loadEngine(root = new URL("..", import.meta.url)) {
  const ctx = {};
  vm.createContext(ctx);
  for (const file of ["js/config.js", "js/engine.js"]) vm.runInContext(readFileSync(new URL(file, root), "utf-8"), ctx);
  vm.runInContext("globalThis.__engine = { classifyActualMove, computeEngineStats, THRESHOLDS };", ctx);
  return ctx.__engine;
}

const isoSec = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const sig = (v) => Number(v.toPrecision(6));

// Devise d'un verdict (spec du cycle §5) : champ currency ; sans champ, émis avant le 20/09/2026
// → EUR, après → USD, sauf CTSI (cartesi) → EUR.
export function verdictCurrency(v) {
  if (v.currency === "USD" || v.currency === "EUR") return v.currency;
  if (v.issued_at < "2026-09-20") return "EUR";
  return v.asset === "cartesi" ? "EUR" : "USD";
}

// Prix du point le plus proche de `iso` dans une série [[ms, prix], …], à PRICE_WINDOW_MS au plus.
export function priceNear(points, iso) {
  const t = Date.parse(iso);
  let best = null;
  for (const p of points || []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || p[1] <= 0) continue;
    const gap = Math.abs(p[0] - t);
    if (gap <= PRICE_WINDOW_MS && (!best || gap < best.gap)) best = { gap, price: p[1] };
  }
  return best ? best.price : null;
}

export function verdictOutcome(v, price, nowIso, engine) {
  const move = round(((price - v.price_at_issue) / v.price_at_issue) * 100, 2);
  const actual = engine.classifyActualMove(move, Number.isFinite(v.threshold_pct) ? v.threshold_pct : engine.THRESHOLDS.directionalMovePct);
  return { price_at_resolution: sig(price), actual_move_pct: move, actual_direction: actual, verdict_correct: v.verdict === actual, resolved_at: nowIso };
}

// global_stats recalculé exactement comme l'onglet Moteur (computeEngineStats).
export function globalStats(verdicts, nowIso, engine, previous = {}) {
  const resolved = verdicts.filter((v) => v.status === "resolved" && v.outcome && v.outcome.actual_direction);
  const s = engine.computeEngineStats(resolved);
  if (!s) return previous;
  const weighted = ["ACHAT", "ATTENTE", "VENTE"].reduce((acc, c) => acc + (s.perClass[c].f1 || 0) * s.perClass[c].actualTotal, 0) / s.total;
  return {
    ...previous,
    last_computed_at: nowIso,
    total_verdicts_issued: verdicts.length,
    total_verdicts_resolved: s.total,
    accuracy_strict_pct: round(s.accuracyPct, 2),
    coverage_pct: round(s.coveragePct, 2),
    baseline_majority_class_pct: round(s.baselineMajorityPct, 2),
    f1_macro: s.f1Macro === null ? null : round(s.f1Macro, 2),
    f1_weighted: round(weighted * 100, 2),
    confusion_matrix: JSON.parse(JSON.stringify(s.matrix)),
  };
}

// Horizon d'opportunité : même règle que la routine horizons-6h (validé si le mouvement atteint
// le seuil, dans le bon sens).
export function horizonOutcome(opp, price, nowIso) {
  const move = round(((price - opp.price_at_flag) / opp.price_at_flag) * 100, 2);
  return { price_at_check: price, move_pct: move, validated: move >= (Number.isFinite(opp.threshold_pct) ? opp.threshold_pct : 5), checked_at: nowIso };
}

// Groupe témoin sans champ devise : la devise est celle dont le cours réel à l'échantillonnage
// colle au prix enregistré (≤ 3 %) alors que l'autre s'en écarte (≥ 6 %) ; sinon null (indécidable).
export function matchCurrency(priceAtIssue, usd, eur) {
  if (!Number.isFinite(usd) || !Number.isFinite(eur)) return null;
  const gap = (p) => Math.abs(p / priceAtIssue - 1);
  if (gap(usd) <= 0.03 && gap(eur) >= 0.06) return "USD";
  if (gap(eur) <= 0.03 && gap(usd) >= 0.06) return "EUR";
  return null;
}

export function controlStats(items, nowIso, thresholdPct) {
  const resolved = items.filter((i) => i.status === "resolved" && i.outcome && Number.isFinite(i.outcome.move_pct));
  if (!resolved.length) return null;
  const validated = resolved.filter((i) => i.outcome.validated === true).length;
  return {
    total_resolved: resolved.length,
    validated_pct: round((validated / resolved.length) * 100, 1),
    note: `${validated} actif${validated > 1 ? "s" : ""} sur ${resolved.length} tirés au hasard dans le Top 300 ont pris +${thresholdPct} % ou plus en 14 jours. Recalculé par le robot de vérification le ${new Date(nowIso).toLocaleDateString("fr-FR", { timeZone: "UTC" })}.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Réseau (CoinGecko public, ~10 appels/min tolérés) et écriture.

let calls = 0;
async function getJson(url, attempt = 1) {
  if (calls > 0) await new Promise((r) => setTimeout(r, 7000));
  calls += 1;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 429 && attempt === 1) {
    await new Promise((r) => setTimeout(r, 65000));
    return getJson(url, 2);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function priceAt(cgId, iso, currency) {
  const t = Math.floor(Date.parse(iso) / 1000);
  const body = await getJson(`${API}/coins/${encodeURIComponent(cgId)}/market_chart/range?vs_currency=${currency.toLowerCase()}&from=${t - 7200}&to=${t + 7200}`);
  return priceNear(body.prices, iso);
}

// Endpoint de la routine horizons-6h : cours du jour (DD-MM-YYYY) de check_at, en euros.
async function dailyEurPrice(cgId, iso) {
  const d = new Date(iso);
  const date = `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
  const body = await getJson(`${API}/coins/${encodeURIComponent(cgId)}/history?date=${date}&localization=false`);
  const p = body && body.market_data && body.market_data.current_price ? body.market_data.current_price.eur : null;
  return Number.isFinite(p) && p > 0 ? p : null;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));
const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

async function resolveVerdicts(now, nowIso, engine, report) {
  if (isQuiet("verdicts", now)) return report.notes.push("verdicts : créneau du cycle, rien touché");
  const verdicts = readJson("data/verdicts.json");
  const due = verdicts.filter((v) => v.status === "pending" && v.resolves_at <= nowIso && Number.isFinite(v.price_at_issue) && v.price_at_issue > 0);
  let changed = 0;
  for (const v of due) {
    if (calls >= MAX_PER_RUN) break;
    try {
      const price = await priceAt(v.asset, v.resolves_at, verdictCurrency(v));
      if (price === null) {
        report.notes.push(`${v.id} : aucun cours à ±2 h de l'échéance, reste en attente`);
        continue;
      }
      v.outcome = verdictOutcome(v, price, nowIso, engine);
      v.status = "resolved";
      changed += 1;
    } catch (e) {
      report.notes.push(`${v.id} : ${e.message}`);
    }
  }
  if (!changed) return;
  writeJson("data/verdicts.json", verdicts);
  const history = readJson("data/engine-history.json");
  history.global_stats = globalStats(verdicts, nowIso, engine, history.global_stats || {});
  writeJson("data/engine-history.json", history);
  report.verdicts = changed;
}

async function resolveHorizons(now, nowIso, report) {
  if (isQuiet("opportunities", now)) return report.notes.push("opportunités : créneau d'une routine, rien touché");
  const data = readJson("data/opportunities.json");
  let changed = 0;
  for (const list of ["opportunities", "archived_opportunities"]) {
    for (const opp of data[list] || []) {
      for (const [key, h] of Object.entries(opp.horizons || {})) {
        if (h.status !== "pending" || !h.check_at || h.check_at > nowIso || !(opp.price_at_flag > 0)) continue;
        if (calls >= MAX_PER_RUN) continue;
        try {
          const price = await dailyEurPrice(opp.cgId, h.check_at);
          if (price === null) {
            report.notes.push(`${opp.id} ${key} : pas de cours ce jour-là, reste en attente`);
            continue;
          }
          h.status = "resolved";
          h.outcome = horizonOutcome(opp, price, nowIso);
          changed += 1;
        } catch (e) {
          report.notes.push(`${opp.id} ${key} : ${e.message}`);
        }
      }
    }
  }
  if (!changed) return;
  writeJson("data/opportunities.json", data);
  report.horizons = changed;
}

async function resolveControl(now, nowIso, engine, report) {
  if (isQuiet("control", now)) return report.notes.push("groupe témoin : créneau de sa routine, rien touché");
  const data = readJson("data/control-group.json");
  let changed = 0;
  for (const item of data.items || []) {
    if (item.status !== "pending" || !item.resolves_at || item.resolves_at > nowIso || !(item.price_at_issue > 0)) continue;
    if (calls >= MAX_PER_RUN - 2) break;
    try {
      // Une série par devise couvrant échantillonnage → échéance (14 j : points horaires) : la devise
      // se décide au départ, le prix d'arrivée se lit dans la même série. 2 appels par actif.
      const from = Math.floor(Date.parse(item.sampled_at) / 1000) - 7200;
      const to = Math.floor(Date.parse(item.resolves_at) / 1000) + 7200;
      const series = {};
      for (const c of ["USD", "EUR"]) {
        if (item.currency && item.currency !== c) continue;
        series[c] = (await getJson(`${API}/coins/${encodeURIComponent(item.cgId)}/market_chart/range?vs_currency=${c.toLowerCase()}&from=${from}&to=${to}`)).prices;
      }
      const currency = item.currency === "USD" || item.currency === "EUR" ? item.currency : matchCurrency(item.price_at_issue, priceNear(series.USD, item.sampled_at), priceNear(series.EUR, item.sampled_at));
      if (!currency) {
        report.notes.push(`${item.id} : devise du prix de départ indécidable, reste en attente`);
        continue;
      }
      const price = priceNear(series[currency], item.resolves_at);
      if (price === null) {
        report.notes.push(`${item.id} : aucun cours à ±2 h de l'échéance, reste en attente`);
        continue;
      }
      const move = round(((price - item.price_at_issue) / item.price_at_issue) * 100, 2);
      item.status = "resolved";
      item.outcome = { price_at_resolution: sig(price), move_pct: move, validated: move >= engine.THRESHOLDS.directionalMovePct, resolved_at: nowIso };
      changed += 1;
    } catch (e) {
      report.notes.push(`${item.id} : ${e.message}`);
    }
  }
  if (!changed) return;
  data.stats = controlStats(data.items, nowIso, engine.THRESHOLDS.directionalMovePct) || data.stats;
  writeJson("data/control-group.json", data);
  report.control = changed;
}

async function main() {
  // RESOLVE_NOW : rejouer un passage à une heure donnée (essais manuels) ; sinon maintenant.
  const now = process.env.RESOLVE_NOW ? new Date(process.env.RESOLVE_NOW) : new Date();
  const nowIso = isoSec(now);
  const engine = loadEngine();
  const report = { verdicts: 0, horizons: 0, control: 0, notes: [] };
  // Trois fichiers, trois modes d'échec : un échec n'empêche jamais les deux autres.
  for (const step of [() => resolveVerdicts(now, nowIso, engine, report), () => resolveHorizons(now, nowIso, report), () => resolveControl(now, nowIso, engine, report)]) {
    try {
      await step();
    } catch (e) {
      report.notes.push(`erreur : ${e.message}`);
    }
  }
  console.log(`${report.verdicts} verdict(s), ${report.horizons} horizon(s), ${report.control} témoin(s) vérifiés ; ${calls} appel(s) de prix`);
  for (const n of report.notes) console.log(`- ${n}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
