// Alertes « seuil_technique » dans data/alerts.json — lancé par .github/workflows/price-alerts.yml.
// Pourquoi : le cycle-2h écrivait ces alertes jusqu'au 14/09/2026 puis a cessé (prompt allégé),
// ce qui a aussi coupé les push du Worker, le mail quotidien et le digest qui les relaient.
// Calcul pur, zéro quota Claude : pour chaque verdict encore actif, prix CoinGecko actuel vs
// price_at_issue ; seuil franchi (threshold_pct du verdict, 5 % par défaut = directionalMovePct)
// → UNE alerte par verdict, jamais deux. Aucun prix = aucune alerte (jamais devinée).
// N'interprète rien : pas d'actualité, pas de conseil — juste le mouvement mesuré.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERDICTS_PATH = "data/verdicts.json";
const ALERTS_PATH = "data/alerts.json";
const DEFAULT_THRESHOLD_PCT = 5;
// Chaque alerte = 1 notification push : jamais de rafale (ex. premier passage après 3 semaines
// sans alertes). Les plus forts mouvements d'abord ; les autres sortent aux passages suivants.
const MAX_ALERTS_PER_RUN = 3;

const nbsp = (s) => s.replace(/[  ]/g, " ");
const fmtPct = (n) => nbsp((n > 0 ? "+" : "") + n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + " %";
const SYMBOL = { eur: "€", usd: "$" };
const fmtPrice = (n, cur) =>
  nbsp(n >= 1 ? n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString("fr-FR", { maximumSignificantDigits: 5 })) + " " + SYMBOL[cur];

// Devise de price_at_issue : AUCUN champ ne la porte et le cycle-2h a mélangé (verdicts d'août et
// CTSI en €, ceux des 20 et 28/09 en $ — constaté le 04/10/2026). On la lit dans le texte du
// verdict : le nombre égal à price_at_issue, suivi de son symbole. Introuvable = null = pas d'alerte.
export function issueCurrency(v) {
  if (v.currency === "EUR" || v.currency === "USD") return v.currency.toLowerCase();
  const re = /(\d[\d\u00a0\u202f ]*(?:,\d+)?)\s?(€|euros?\b|\$|USD\b|EUR\b|dollars?\b)/gi;
  for (const m of String(v.reasoning || "").matchAll(re)) {
    const n = parseFloat(m[1].replace(/[\u00a0\u202f ]/g, "").replace(",", "."));
    if (Math.abs(n - v.price_at_issue) <= Math.abs(v.price_at_issue) * 1e-6) return /\$|usd|dollar/i.test(m[2]) ? "usd" : "eur";
  }
  return null;
}
const fmtDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Fonction pure (testée dans test/price-alerts.test.js). Retourne les nouvelles alertes à ajouter.
// prices = { eur: {cgId: prix}, usd: {cgId: prix} }
export function buildPriceAlerts(verdicts, alerts, prices, now = new Date()) {
  const nowIso = now.toISOString();
  const alreadyAlerted = new Set((alerts || []).map((a) => a.verdict_id).filter(Boolean));
  const usedIds = new Set((alerts || []).map((a) => a.id));
  const candidates = [];
  for (const v of verdicts || []) {
    if (v.status !== "pending" || !v.resolves_at || v.resolves_at <= nowIso) continue;
    if (alreadyAlerted.has(v.id)) continue;
    const issue = v.price_at_issue;
    const cur = issueCurrency(v);
    if (!cur) continue;
    const price = ((prices && prices[cur]) || {})[v.asset];
    if (typeof issue !== "number" || issue <= 0 || typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    const threshold = typeof v.threshold_pct === "number" && v.threshold_pct > 0 ? v.threshold_pct : DEFAULT_THRESHOLD_PCT;
    const move = ((price - issue) / issue) * 100;
    if (Math.abs(move) < threshold) continue;
    candidates.push({ v, issue, price, threshold, move, cur });
  }
  candidates.sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
  const out = [];
  for (const { v, issue, price, threshold, move, cur } of candidates.slice(0, MAX_ALERTS_PER_RUN)) {
    const up = move > 0;
    let sens = "";
    if (v.verdict === "ACHAT") sens = up ? ", dans le sens du verdict" : ", en sens opposé au verdict";
    if (v.verdict === "VENTE") sens = up ? ", en sens opposé au verdict" : ", dans le sens du verdict";
    let id = `alert-${nowIso.slice(0, 10).replace(/-/g, "")}-${String(v.ticker).toLowerCase()}-seuil`;
    if (usedIds.has(id)) id += `-${v.id}`; // l'id sert de clé anti-doublon au push du Worker
    usedIds.add(id);
    out.push({
      id,
      ticker_ou_theme: v.ticker,
      type: "seuil_technique",
      triggered_at: nowIso.replace(/\.\d{3}Z$/, "Z"),
      verdict_id: v.id,
      sentiment: up ? "positif" : "négatif",
      message:
        `${v.ticker} : ${fmtPct(move)} depuis l'émission du verdict ${v.verdict} du ${fmtDay(v.issued_at)} ` +
        `(${fmtPrice(issue, cur)} → ${fmtPrice(price, cur)}), seuil de mouvement directionnel de ${threshold} % franchi ` +
        `à la ${up ? "hausse" : "baisse"}${sens}. Calcul automatique sur le prix, sans analyse d'actualité — ` +
        `le verdict reste à juger à son échéance.`,
      source: "Calcul automatique (GitHub Action price-alerts) : prix CoinGecko /simple/price vs price_at_issue du verdict, même devise (${cur.toUpperCase()})",
    });
  }
  return out;
}

async function fetchPrices(ids) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=eur,usd`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const body = await res.json();
  const pick = (cur) => Object.fromEntries(Object.entries(body).map(([id, v]) => [id, v && v[cur]]));
  return { eur: pick("eur"), usd: pick("usd") };
}

async function main() {
  const verdicts = JSON.parse(readFileSync(VERDICTS_PATH, "utf8"));
  const alertsRaw = readFileSync(ALERTS_PATH, "utf8");
  const alerts = JSON.parse(alertsRaw);
  const now = new Date();
  const active = verdicts.filter((v) => v.status === "pending" && v.resolves_at > now.toISOString());
  if (active.length === 0) return console.log("Aucun verdict actif.");
  const prices = await fetchPrices([...new Set(active.map((v) => v.asset))]);
  const fresh = buildPriceAlerts(verdicts, alerts, prices, now);
  if (fresh.length === 0) return console.log(`${active.length} verdicts actifs, aucun seuil franchi.`);
  alerts.push(...fresh);
  writeFileSync(ALERTS_PATH, JSON.stringify(alerts, null, 2) + (alertsRaw.endsWith("\n") ? "\n" : "")); // diff = ajout seul
  fresh.forEach((a) => console.log(a.message));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
