// Jauges de marché brutes dans data/market-gauges.json — lancé par .github/workflows/price-alerts.yml.
// Peur/cupidité, dominance BTC, cours de l'or (approché via 2 jetons adossés à l'or, voir
// parseGoldTokens). Pourquoi : engine-history.json.macro_regime (peur/cupidité, dominance BTC)
// n'était plus mis à jour depuis le 14/09/2026 (allègement du cycle-2h) et le site les affichait
// comme actuels.
// Uniquement des MESURES publiques, aucun jugement : le régime (risk-on/neutre/risk-off) reste
// décidé par le cycle-2h (docs/routines/cycle-2h-verdict.md §4). Une source en échec = son champ
// à null avec la raison, jamais une valeur reprise d'avant ou estimée. Fichier d'état courant
// (écrasé à chaque passage), pas un historique.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GAUGES_PATH = "data/market-gauges.json";
const isoSec = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

// Fonctions pures (testées dans test/market-gauges.test.js).
export function parseFearGreed(body) {
  const d = body && Array.isArray(body.data) ? body.data[0] : null;
  const value = d ? Number(d.value) : NaN;
  const ts = d ? Number(d.timestamp) : NaN;
  if (!Number.isFinite(value) || value < 0 || value > 100 || !Number.isFinite(ts)) return null;
  return { value, classification: d.value_classification || null, as_of: isoSec(new Date(ts * 1000)), source: "alternative.me /fng (Crypto Fear & Greed Index)" };
}

export function parseGlobal(body) {
  const d = body && body.data;
  const btc = d && d.market_cap_percentage ? Number(d.market_cap_percentage.btc) : NaN;
  if (!Number.isFinite(btc) || btc <= 0 || btc >= 100) return null;
  const ts = Number(d.updated_at);
  return {
    pct: Math.round(btc * 100) / 100,
    as_of: Number.isFinite(ts) ? isoSec(new Date(ts * 1000)) : null,
    source: "CoinGecko /api/v3/global (market_cap_percentage.btc)",
  };
}

// Or : deux jetons adossés chacun à une once d'or physique (ids vérifiés via CoinGecko /search le
// 10/10/2026). Ajouté car la routine marche-quotidien laissait market-context.gold à null, faute
// de cours daté trouvé par recherche web. Les deux jetons doivent concorder à
// GOLD_MAX_SPREAD_PCT près : un jeton décroché de l'or ne doit jamais passer pour le cours.
export const GOLD_TOKEN_IDS = ["pax-gold", "tether-gold"];
export const GOLD_MAX_SPREAD_PCT = 2;

export function parseGoldTokens(body) {
  const quotes = GOLD_TOKEN_IDS.map((id) => (body && body[id]) || {});
  const prices = quotes.map((q) => Number(q.usd));
  if (prices.some((p) => !Number.isFinite(p) || p <= 0)) return null;
  const mean = (prices[0] + prices[1]) / 2;
  const spreadPct = (Math.abs(prices[0] - prices[1]) / mean) * 100;
  if (spreadPct > GOLD_MAX_SPREAD_PCT) return null;
  const stamps = quotes.map((q) => Number(q.last_updated_at)).filter(Number.isFinite);
  return {
    usd_per_oz: Math.round(mean * 100) / 100,
    spread_pct: Math.round(spreadPct * 100) / 100,
    as_of: stamps.length === 2 ? isoSec(new Date(Math.min(...stamps) * 1000)) : null,
    source: "CoinGecko /simple/price : moyenne PAX Gold + Tether Gold (jetons adossés chacun à une once d'or) — approximation du cours au comptant",
  };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const out = { updated_at: isoSec(new Date()), fear_greed: null, btc_dominance: null, gold: null, errors: [] };
  try {
    out.fear_greed = parseFearGreed(await getJson("https://api.alternative.me/fng/?limit=1"));
    if (!out.fear_greed) out.errors.push("fear_greed : réponse alternative.me inexploitable");
  } catch (e) {
    out.errors.push(`fear_greed : ${e.message}`);
  }
  try {
    out.btc_dominance = parseGlobal(await getJson("https://api.coingecko.com/api/v3/global"));
    if (!out.btc_dominance) out.errors.push("btc_dominance : réponse CoinGecko inexploitable");
  } catch (e) {
    out.errors.push(`btc_dominance : ${e.message}`);
  }
  try {
    out.gold = parseGoldTokens(
      await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${GOLD_TOKEN_IDS.join(",")}&vs_currencies=usd&include_last_updated_at=true`)
    );
    if (!out.gold) out.errors.push(`gold : jetons or absents ou en désaccord de plus de ${GOLD_MAX_SPREAD_PCT} %`);
  } catch (e) {
    out.errors.push(`gold : ${e.message}`);
  }
  if (!out.fear_greed && !out.btc_dominance && !out.gold) {
    console.error("Aucune jauge récupérée, fichier laissé tel quel :", out.errors.join(" ; "));
    return;
  }
  writeFileSync(GAUGES_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Peur/cupidité ${out.fear_greed?.value ?? "—"}, dominance BTC ${out.btc_dominance?.pct ?? "—"} %, or ${out.gold?.usd_per_oz ?? "—"} $`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
