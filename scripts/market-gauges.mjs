// Jauges de marché brutes dans data/market-gauges.json — lancé par .github/workflows/price-alerts.yml.
// Pourquoi : engine-history.json.macro_regime (peur/cupidité, dominance BTC) n'était plus mis à
// jour depuis le 14/09/2026 (allègement du cycle-2h) et le site les affichait comme actuels.
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

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const out = { updated_at: isoSec(new Date()), fear_greed: null, btc_dominance: null, errors: [] };
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
  if (!out.fear_greed && !out.btc_dominance) {
    console.error("Aucune jauge récupérée, fichier laissé tel quel :", out.errors.join(" ; "));
    return;
  }
  writeFileSync(GAUGES_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Peur/cupidité ${out.fear_greed?.value ?? "—"}, dominance BTC ${out.btc_dominance?.pct ?? "—"} %`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
