// Ajoute 1 point réel par jour à data/portfolio-history.json (valeur totale du portefeuille).
// Lancé par .github/workflows/portfolio-snapshot.yml — aucune routine Claude, donc zéro quota.
// Pourquoi : plus aucune routine n'écrivait ce fichier depuis le 14/09/2026 (graphique figé).
// Même discipline que le reste du site : prix réellement récupérés (CoinGecko /simple/price),
// jamais deviné. Une seule position sans prix ou sans quantité = jour sauté (jamais un total
// partiel présenté comme complet), jamais de backfill, jamais deux points le même jour.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PORTFOLIO_PATH = "data/portfolio.json";
const HISTORY_PATH = "data/portfolio-history.json";

const round2 = (n) => Math.round(n * 100) / 100;

// Fonction pure (testée dans test/portfolio-snapshot.test.js). Retourne { snapshot } ou { skip }.
export function buildSnapshot(positions, pricesEur, history, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const snapshots = (history && history.snapshots) || [];
  if (snapshots.some((s) => s.date === date)) return { skip: `snapshot déjà présent pour ${date}` };
  if (!positions || positions.length === 0) return { skip: "aucune position" };

  let value = 0;
  let invested = 0;
  for (const p of positions) {
    if (p.pending || typeof p.qty !== "number" || typeof p.invested !== "number") {
      return { skip: `position ${p.cgId} incomplète (qty/invested non confirmés)` };
    }
    const price = pricesEur[p.cgId];
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return { skip: `prix EUR introuvable pour ${p.cgId}` };
    }
    value += p.qty * price;
    invested += p.invested;
  }
  const pnl = value - invested;
  return {
    snapshot: {
      date,
      computed_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
      total_value_eur: round2(value),
      total_invested_eur: round2(invested),
      total_pnl_eur: round2(pnl),
      total_pnl_pct: invested ? round2((pnl / invested) * 100) : null,
      source: "CoinGecko /simple/price (GitHub Action portfolio-snapshot)",
    },
  };
}

async function fetchPricesEur(ids) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=eur`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const body = await res.json();
  return Object.fromEntries(Object.entries(body).map(([id, v]) => [id, v && v.eur]));
}

async function main() {
  const portfolio = JSON.parse(readFileSync(PORTFOLIO_PATH, "utf8"));
  const history = JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
  const positions = portfolio.positions || [];
  const prices = await fetchPricesEur(positions.map((p) => p.cgId));
  const result = buildSnapshot(positions, prices, history);
  if (result.skip) {
    console.log(`Jour sauté : ${result.skip}`);
    return;
  }
  history.snapshots.push(result.snapshot);
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
  console.log(`Point ajouté : ${result.snapshot.date} · ${result.snapshot.total_value_eur} €`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
