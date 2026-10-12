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
const MAX_ITEMS = 40;
// Plafonds par sujet : titres sur le seul bitcoin/ether, et par autre favori — sinon un seul
// sujet très couvert chasse tous les autres du fil.
const MAX_MAJORS_ONLY = 12;
const MAX_PER_ALT = 5;
const MAX_AGE_DAYS = 7;

// Deux recherches Google Actualités : le bitcoin et l'ether occupent sinon tout le fil (constaté au
// 1er passage, 12/10/2026 : 24 titres BTC + 7 ETH sur 30, aucun autre favori, 12 h couvertes).
const GOOGLE_MAJORS = "(bitcoin OR ethereum) crypto when:1d";
const GOOGLE_ALTS = '(chainlink OR arbitrum OR celestia OR injective OR "ondo finance" OR livepeer OR "the graph" OR cartesi OR peaq OR aioz OR "fetch.ai" OR "jupiter exchange" OR "flux network") crypto when:7d';
const google = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
export const FEEDS = [
  { name: "Google Actualités (fr) — bitcoin, ether", url: google(GOOGLE_MAJORS), aggregator: true },
  { name: "Google Actualités (fr) — autres favoris", url: google(GOOGLE_ALTS), aggregator: true },
  { name: "Cointribune", url: "https://www.cointribune.com/feed/" },
  { name: "Journal du Coin", url: "https://journalducoin.com/feed/" },
];

// Repérage des favoris dans un titre. Noms propres : sans casse. Tickers et mots courants en
// français (« flux », « link », « the graph ») : casse exacte, pour ne pas confondre « flux ETF » et FLUX.
// Noms partagés avec autre chose (`context`) : retenus seulement avec un mot du monde crypto dans le
// titre/extrait, et jamais avec un mot du sens concurrent (`exclude`). Constaté au 2e relevé réel
// (12/10/2026) : Škoda Peaq (voiture), trains Celestia d'Eurostar.
export const TICKER_PATTERNS = {
  BTC: { name: /\b(bitcoin|btc)\b/i },
  ETH: { name: /\b(ethereum|ether)\b/i, ticker: /\bETH\b/ },
  FET: { name: /fetch\.ai|asi alliance|artificial superintelligence/i, ticker: /\bFET\b/ },
  GRT: { name: /\bThe Graph\b/, ticker: /\bGRT\b/, context: true },
  TIA: { name: /\bcelestia\b/i, ticker: /\bTIA\b/, context: true, exclude: /eurostar|\btrains?\b|sncf|ferroviaire/i },
  CTSI: { name: /\bcartesi\b/i, ticker: /\bCTSI\b/ },
  PEAQ: { name: /\bpeaq\b/i, context: true, exclude: /[sš]koda|enyaq|epiq|\bsuv\b|voiture|automobile/i },
  LINK: { name: /\bchainlink\b/i, ticker: /\bLINK\b/ },
  ONDO: { name: /\bondo\b/i, context: true },
  JUP: { name: /\bjupiter (exchange|dex|ag)\b/i, ticker: /\bJUP\b/ },
  LPT: { name: /\blivepeer\b/i, ticker: /\bLPT\b/ },
  AIOZ: { name: /\baioz\b/i },
  // « flux crypto » = les flux de capitaux en français : jamais retenu seul.
  FLUX: { name: /\bflux (network|token)\b/i, ticker: /\bFLUX\b/ },
  ARB: { name: /\barbitrum\b/i, ticker: /\bARB\b/ },
  INJ: { name: /\binjective\b/i, ticker: /\bINJ\b/ },
};
const CRYPTO_CONTEXT = /crypto|token|jeton|blockchain|\bdefi\b|depin|staking|altcoin|bitcoin|ethereum|\bcours\b|\bprix\b|stablecoin|tokenis|airdrop|mainnet|testnet|rollup|\blayer\b|binance|coinbase|\bdata availability\b/i;
const MAJORS = new Set(["BTC", "ETH"]);

export function tickersIn(text) {
  const t = String(text || "");
  return Object.entries(TICKER_PATTERNS)
    .filter(([, p]) => {
      if (p.exclude && p.exclude.test(t)) return false;
      if (p.ticker && p.ticker.test(t)) return true;
      return p.name.test(t) && (!p.context || CRYPTO_CONTEXT.test(t));
    })
    .map(([k]) => k);
}

// Pages sans valeur d'information : source réduite à une adresse (sites de recopie) ou
// convertisseurs de devises (« Convertir 1 INJ en MDL »).
export function isJunk(item) {
  return /^https?:\/\//i.test(item.source || "") || /^convertir\b|convertisseur|\bconvert \d/i.test(item.title || "");
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
// ou même titre chez plusieurs médias), le plus récent en premier, plafonds par sujet, MAX_ITEMS au
// plus. Favoris recalculés à chaque passage (titres conservés) : une règle de repérage corrigée
// s'applique aussi aux anciens titres.
export function mergeFeed(previous, fresh, now = new Date()) {
  const minTime = now.getTime() - MAX_AGE_DAYS * 86400000;
  const seenUrl = new Set();
  const seenTitle = new Set();
  const perTopic = new Map();
  const out = [];
  const all = [...fresh, ...((previous && previous.items) || [])].sort((a, b) => b.published_at.localeCompare(a.published_at));
  for (const it of all) {
    const t = Date.parse(it.published_at);
    if (!Number.isFinite(t) || t < minTime || t > now.getTime() + 3600000 || isJunk(it)) continue;
    const tickers = tickersIn(`${it.title} ${it.excerpt || ""}`);
    if (!tickers.length) continue;
    const key = normTitle(it.title);
    if (seenUrl.has(it.url) || seenTitle.has(key)) continue;
    const topic = tickers.find((k) => !MAJORS.has(k)) || "MAJORS";
    const cap = topic === "MAJORS" ? MAX_MAJORS_ONLY : MAX_PER_ALT;
    if ((perTopic.get(topic) || 0) >= cap) continue;
    perTopic.set(topic, (perTopic.get(topic) || 0) + 1);
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
