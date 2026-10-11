// Recoupement quotidien CoinGecko ↔ CoinMarketCap (API officielle CMC, clé gratuite « Basic »,
// secret GitHub CMC_API_KEY). Sans clé : étape sautée, rien n'est inventé. Pourquoi : un chiffre
// confirmé par deux sources indépendantes est plus sûr ; le 11/10/2026, le recoupement manuel
// (connecteur CoinMarketCap) a confirmé les cours mais trouvé 3 offres divergentes (JUP, INJ, FLUX :
// définitions différentes de l'offre maximale). Ids CMC vérifiés (même table que cmc-snapshot.py).
export const CMC_IDS = { BTC: 1, ETH: 1027, FET: 3773, GRT: 6719, TIA: 22861, CTSI: 5444, PEAQ: 14588, LINK: 1975, ONDO: 21159, JUP: 29210, LPT: 3640, AIOZ: 9104, FLUX: 3029, ARB: 11841, INJ: 7226 };
export const PRICE_GAP_ALERT_PCT = 3; // au-delà : cours à vérifier (décalage d'heure ou erreur)
export const SUPPLY_GAP_ALERT_PCT = 10;

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const gap = (a, b) => (num(a) && num(b) ? Math.round((a / b - 1) * 1000) / 10 : null);

// Réponse /v1/cryptocurrency/quotes/latest?id=… : { data: { "<id>": { circulating_supply,
// max_supply, total_supply, quote: { USD: { price, market_cap, fully_diluted_market_cap } } } } }.
export function parseCmcQuotes(body) {
  const out = {};
  const data = body && body.data;
  if (!data || typeof data !== "object") return out;
  for (const [ticker, id] of Object.entries(CMC_IDS)) {
    const raw = data[String(id)];
    const c = Array.isArray(raw) ? raw[0] : raw;
    const usd = c && c.quote && c.quote.USD;
    if (!c || !usd || !num(usd.price)) continue;
    out[ticker] = { price_usd: usd.price, market_cap_usd: num(usd.market_cap), fdv_usd: num(usd.fully_diluted_market_cap), circulating_supply: num(c.circulating_supply), max_supply: num(c.max_supply) };
  }
  return out;
}

// Comparaison avec la lecture CoinGecko du robot (assets[TICKER].price_usd et .supply).
export function crossCheck(assets, cmc) {
  const rows = {};
  for (const [ticker, a] of Object.entries(assets || {})) {
    const m = cmc[ticker];
    if (!m) continue;
    const s = a.supply || {};
    const priceGap = gap(a.price_usd, m.price_usd);
    const circGap = gap(s.circulating_supply, m.circulating_supply);
    const maxDiffers = (s.max_supply == null) !== (m.max_supply == null) || (num(s.max_supply) && num(m.max_supply) && Math.abs(gap(s.max_supply, m.max_supply)) > SUPPLY_GAP_ALERT_PCT);
    const notes = [];
    if (priceGap !== null && Math.abs(priceGap) > PRICE_GAP_ALERT_PCT) notes.push(`cours : écart de ${priceGap} % entre CoinGecko et CoinMarketCap`);
    if (circGap !== null && Math.abs(circGap) > SUPPLY_GAP_ALERT_PCT) notes.push(`offre en circulation : écart de ${circGap} %`);
    if (maxDiffers) notes.push(`offre maximale : ${s.max_supply ?? "non plafonnée"} (CoinGecko) contre ${m.max_supply ?? "non plafonnée"} (CoinMarketCap)`);
    rows[ticker] = { cmc_price_usd: m.price_usd, price_gap_pct: priceGap, circulating_gap_pct: circGap, cmc_max_supply: m.max_supply, agreed: notes.length === 0, notes };
  }
  return rows;
}

export async function fetchCmcQuotes(apiKey) {
  const res = await fetch(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?id=${Object.values(CMC_IDS).join(",")}&convert=USD`, { headers: { accept: "application/json", "X-CMC_PRO_API_KEY": apiKey } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCmcQuotes(await res.json());
}
