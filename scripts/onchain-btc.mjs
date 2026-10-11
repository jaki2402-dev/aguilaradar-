// Instantané on-chain quotidien du bitcoin dans data/onchain-history.json (GitHub Action
// price-alerts, aucun quota Claude). Pourquoi : la routine favoris-quotidien devait interroger
// api.blockchain.info et api.llama.fi, bloqués par le proxy de son environnement ; elle se
// rabattait sur des chiffres arrondis trouvés par recherche web, et plus rien depuis le 04/10/2026
// (graphique figé). Les runners GitHub y accèdent directement.
// Règles du fichier (inchangées) : en ajout seulement, un point par jour, jamais interpolé ni
// rétro-daté au-delà du dernier jour complet ; date = jour des DONNÉES (dernier jour UTC complet),
// pas jour d'exécution — un passage retardé ne peut donc ni sauter ni doubler un jour.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PATH = "data/onchain-history.json";
const DAY = 86400;
const isoSec = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const dayOf = (unix) => new Date(Math.floor(unix / DAY) * DAY * 1000).toISOString().slice(0, 10);

// Points d'un graphique blockchain.info ({ values: [{ x: unix, y }] }) → Map(date → valeur).
export function chartByDay(body) {
  const out = new Map();
  for (const p of (body && body.values) || []) if (Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > 0) out.set(dayOf(p.x), Math.round(p.y));
  return out;
}

// DefiLlama /v2/historicalChainTvl/Bitcoin ([{ date: unix, tvl }]) → Map(date → TVL en $).
export function tvlByDay(body) {
  const out = new Map();
  for (const p of Array.isArray(body) ? body : []) if (Number.isFinite(p.date) && Number.isFinite(p.tvl) && p.tvl > 0) out.set(dayOf(p.date), Math.round(p.tvl));
  return out;
}

// Dernier jour COMPLET (avant aujourd'hui UTC) où transactions et adresses actives sont connues.
export function buildBtcSnapshot(tx, addresses, tvl, history, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const days = [...tx.keys()].filter((d) => d < today && addresses.has(d)).sort();
  const date = days.pop();
  if (!date) return { skip: "aucun jour complet avec transactions et adresses actives" };
  const snaps = (history && history.assets && history.assets.bitcoin && history.assets.bitcoin.snapshots) || [];
  if (snaps.some((s) => s.date === date)) return { skip: `instantané déjà présent pour ${date}` };
  if (snaps.length && snaps[snaps.length - 1].date > date) return { skip: `dernier instantané (${snaps[snaps.length - 1].date}) plus récent que ${date}` };
  return {
    snapshot: {
      date,
      computed_at: isoSec(now),
      tvl_usd: tvl.has(date) ? tvl.get(date) : null,
      tx_per_day: tx.get(date),
      active_addresses: addresses.get(date),
      source: {
        tvl_usd: tvl.has(date) ? "DefiLlama API /v2/historicalChainTvl/Bitcoin (GitHub Action)" : "non disponible pour ce jour chez DefiLlama",
        tx_per_day: "Blockchain.com API /charts/n-transactions (GitHub Action)",
        active_addresses: "Blockchain.com API /charts/n-unique-addresses (GitHub Action)",
      },
    },
  };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const now = new Date();
  // 08h-09h UTC : créneau de la routine favoris-quotidien, qui écrit ce même fichier (ETH, ARB…).
  if (now.getUTCHours() === 8) return console.log("Créneau de la routine favoris-quotidien : rien touché.");
  const tx = chartByDay(await getJson("https://api.blockchain.info/charts/n-transactions?timespan=7days&format=json&sampled=false"));
  const addresses = chartByDay(await getJson("https://api.blockchain.info/charts/n-unique-addresses?timespan=7days&format=json&sampled=false"));
  let tvl = new Map();
  try {
    tvl = tvlByDay(await getJson("https://api.llama.fi/v2/historicalChainTvl/Bitcoin"));
  } catch (e) {
    console.log(`TVL indisponible (${e.message}) : instantané sans TVL.`);
  }
  const history = JSON.parse(readFileSync(PATH, "utf-8"));
  const result = buildBtcSnapshot(tx, addresses, tvl, history, now);
  if (result.skip) return console.log(`Rien ajouté : ${result.skip}`);
  history.assets = history.assets || {};
  history.assets.bitcoin = history.assets.bitcoin || { snapshots: [] };
  history.assets.bitcoin.snapshots = [...(history.assets.bitcoin.snapshots || []), result.snapshot];
  writeFileSync(PATH, JSON.stringify(history, null, 2) + "\n");
  console.log(`Bitcoin ${result.snapshot.date} : ${result.snapshot.tx_per_day} transactions, ${result.snapshot.active_addresses} adresses actives, TVL ${result.snapshot.tvl_usd ?? "—"}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
