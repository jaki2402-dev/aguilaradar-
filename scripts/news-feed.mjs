// Fil d'actualités des favoris (data/news-feed.json) — GitHub Action price-alerts, aucun quota.
// Pourquoi : la veille du cycle (docs/routines/cycle-2h-verdict.md §8) n'ajoute une actualité que si
// elle est jugée « réellement nouvelle et significative » ; plus rien depuis le 05/10/2026 (7 jours)
// et ses items ne sont pas datés. Ce robot ne remplace pas cette sélection : il récupère les TITRES
// RÉELS des médias crypto francophones (flux RSS publics) qui citent un des 15 favoris, datés et
// sourcés, affichés à part (« Fil des médias »). Rien n'est résumé ni réécrit : titre et extrait
// tels que publiés par le média. Fichier tournant (7 derniers jours), propriété de ce seul robot.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PATH = "data/news-feed.json";
const MAX_ITEMS = 30;
const MAX_AGE_DAYS = 7;

const GOOGLE_QUERY = '(bitcoin OR ethereum OR chainlink OR arbitrum OR celestia OR injective OR "ondo finance" OR livepeer OR "the graph" OR cartesi OR peaq OR aioz OR "fetch.ai" OR "jupiter exchange") crypto when:2d';
export const FEEDS = [
  { name: "Google Actualités (fr)", url: `https://news.google.com/rss/search?q=${encodeURIComponent(GOOGLE_QUERY)}&hl=fr&gl=FR&ceid=FR:fr`, aggregator: true },
  { name: "Cointribune", url: "https://www.cointribune.com/feed/" },
  { name: "Journal du Coin", url: "https://journalducoin.com/feed/" },
];

// Repérage des favoris dans un titre. Noms : sans casse. Tickers courts ou mots courants en
// français (« flux », « link ») : seulement en MAJUSCULES, pour ne pas confondre « flux ETF » et FLUX.
export const TICKER_PATTERNS = {
  BTC: /\b(bitcoin|btc)\b/i,
  ETH: /\b(ethereum|ether)\b/i,
  FET: /(fetch\.ai|asi alliance|artificial superintelligence)|\bFET\b/i,
  GRT: /\bthe graph\b|\bGRT\b/i,
  TIA: /\bcelestia\b|\bTIA\b/,
  CTSI: /\bcartesi\b|\bCTSI\b/i,
  PEAQ: /\bpeaq\b/i,
  LINK: /\bchainlink\b|\bLINK\b/,
  ONDO: /\bondo\b/i,
  JUP: /\bjupiter (exchange|dex|ag)\b|\bJUP\b/,
  LPT: /\blivepeer\b|\bLPT\b/i,
  AIOZ: /\baioz\b/i,
  FLUX: /\bFLUX\b|\bflux (network|crypto|token)\b/,
  ARB: /\barbitrum\b|\bARB\b/i,
  INJ: /\binjective\b|\bINJ\b/i,
};
const ETH_TICKER = /\bETH\b/;

export function tickersIn(text) {
  const t = String(text || "");
  const found = Object.entries(TICKER_PATTERNS).filter(([, re]) => re.test(t)).map(([k]) => k);
  if (!found.includes("ETH") && ETH_TICKER.test(t)) found.push("ETH");
  return found;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function cleanText(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
};

// RSS 2.0 générique (WordPress, Google Actualités). Google ajoute « - Média » au titre et une
// balise <source> : le média réel est gardé comme source.
export function parseRss(xml, feed) {
  const items = [];
  for (const m of String(xml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const raw = m[1];
    let title = cleanText(tag(raw, "title"));
    const link = cleanText(tag(raw, "link"));
    const pub = Date.parse(cleanText(tag(raw, "pubDate")));
    let source = feed.name;
    if (feed.aggregator) {
      const src = cleanText(tag(raw, "source"));
      if (src) {
        source = src;
        if (title.endsWith(` - ${src}`)) title = title.slice(0, -(src.length + 3)).trim();
      }
    }
    const description = feed.aggregator ? "" : cleanText(tag(raw, "description"));
    if (!title || !/^https:\/\//.test(link) || !Number.isFinite(pub)) continue;
    items.push({ title, url: link, source, published_at: new Date(pub).toISOString().replace(/\.\d{3}Z$/, "Z"), excerpt: description && description !== title ? description.slice(0, 220) : null });
  }
  return items;
}

const normTitle = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// Fusion avec le fil existant : favoris cités seulement, 7 derniers jours, sans doublon (même lien
// ou même titre chez plusieurs médias), le plus récent en premier, MAX_ITEMS au plus.
export function mergeFeed(previous, fresh, now = new Date()) {
  const minTime = now.getTime() - MAX_AGE_DAYS * 86400000;
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];
  const all = [...fresh, ...((previous && previous.items) || [])].sort((a, b) => b.published_at.localeCompare(a.published_at));
  for (const it of all) {
    const t = Date.parse(it.published_at);
    if (!Number.isFinite(t) || t < minTime || t > now.getTime() + 3600000) continue;
    const tickers = it.tickers && it.tickers.length ? it.tickers : tickersIn(`${it.title} ${it.excerpt || ""}`);
    if (!tickers.length) continue;
    const key = normTitle(it.title);
    if (seenUrl.has(it.url) || seenTitle.has(key)) continue;
    seenUrl.add(it.url);
    seenTitle.add(key);
    out.push({ ...it, tickers });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, { headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "AguilaRadar/1.0 (+https://github.com/jaki2402-dev/aguilaradar-)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRss(await res.text(), feed);
}

async function main() {
  const now = new Date();
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(PATH, "utf-8"));
  } catch {
    previous = null;
  }
  const fresh = [];
  const errors = [];
  const ok = [];
  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed(feed);
      fresh.push(...items);
      ok.push(`${feed.name} (${items.length})`);
    } catch (e) {
      errors.push(`${feed.name} : ${e.message}`);
    }
  }
  if (!ok.length) {
    console.error("Aucun flux joignable, fichier laissé tel quel :", errors.join(" ; "));
    return;
  }
  const items = mergeFeed(previous, fresh, now);
  writeFileSync(PATH, JSON.stringify({ updated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"), sources: FEEDS.map((f) => f.name), items, errors }, null, 2) + "\n");
  console.log(`${items.length} titre(s) ; flux lus : ${ok.join(", ")}${errors.length ? ` ; erreurs : ${errors.join(" ; ")}` : ""}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
