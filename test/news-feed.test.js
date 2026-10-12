import { describe, it, expect } from "vitest";
import { parseRss, tickersIn, cleanText, mergeFeed, isJunk } from "../scripts/news-feed.mjs";

const GOOGLE = `<?xml version="1.0"?><rss><channel>
<item><title>Bitcoin : les ETF enregistrent une nouvelle semaine d&#39;entrées - Les Echos</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Mon, 12 Oct 2026 09:30:00 GMT</pubDate><description>&lt;a href="x"&gt;lien&lt;/a&gt;</description><source url="https://www.lesechos.fr">Les Echos</source></item>
<item><title>Pas de favori ici - Le Monde</title><link>https://news.google.com/rss/articles/def</link><pubDate>Mon, 12 Oct 2026 08:00:00 GMT</pubDate><source url="https://www.lemonde.fr">Le Monde</source></item>
</channel></rss>`;

const WORDPRESS = `<rss><channel><item><title><![CDATA[Chainlink (LINK) : le CCIP arrive sur une nouvelle chaîne]]></title><link>https://www.cointribune.com/chainlink-ccip/</link><pubDate>Sun, 11 Oct 2026 18:12:00 +0000</pubDate><description><![CDATA[<p>Le protocole d’oracles étend son pont inter-chaînes&#8230;</p>]]></description></item>
<item><title>Item sans lien</title><pubDate>Sun, 11 Oct 2026 18:12:00 +0000</pubDate></item></channel></rss>`;

describe("scripts/news-feed.mjs — fil des médias crypto", () => {
  it("lit un flux Google Actualités : média réel comme source, suffixe retiré du titre, entités décodées", () => {
    const items = parseRss(GOOGLE, { name: "Google Actualités (fr)", aggregator: true });
    expect(items[0]).toEqual({ title: "Bitcoin : les ETF enregistrent une nouvelle semaine d'entrées", url: "https://news.google.com/rss/articles/abc", source: "Les Echos", published_at: "2026-10-12T09:30:00Z", excerpt: null });
    expect(items).toHaveLength(2);
  });

  it("lit un flux WordPress (CDATA, extrait du média), ignore un item sans lien", () => {
    const items = parseRss(WORDPRESS, { name: "Cointribune" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Chainlink (LINK) : le CCIP arrive sur une nouvelle chaîne", source: "Cointribune", published_at: "2026-10-11T18:12:00Z" });
    expect(items[0].excerpt).toBe("Le protocole d’oracles étend son pont inter-chaînes…");
  });

  it("repère les favoris sans faux positifs sur les mots courants (« flux ETF », « link »)", () => {
    expect(tickersIn("Bitcoin et Ethereum reculent")).toEqual(["BTC", "ETH"]);
    expect(tickersIn("Les flux ETF restent positifs")).toEqual([]);
    expect(tickersIn("Flux (FLUX) lance un nouveau nœud")).toEqual(["FLUX"]);
    expect(tickersIn("un link vers le site")).toEqual([]);
    expect(tickersIn("Chainlink et LINK")).toEqual(["LINK"]);
    expect(tickersIn("ETH : le prix grimpe")).toEqual(["ETH"]);
    expect(tickersIn("Les flux crypto vers les ETF")).toEqual([]);
    expect(tickersIn("the graph shows a rise")).toEqual([]);
    expect(tickersIn("The Graph (GRT) migre vers Arbitrum")).toEqual(["GRT", "ARB"]);
  });

  it("noms partagés : la voiture Škoda Peaq et les trains Celestia ne sont pas des favoris (titres réels du 12/10)", () => {
    expect(tickersIn("Comparatif : BYD Seal U vs Škoda Peaq")).toEqual([]);
    expect(tickersIn("Skoda montre l’Epiq Sportline à Paris et annonce 70 000 commandes pour l’Epiq et le Peaq")).toEqual([]);
    expect(tickersIn("Eurostar prépare ses nouveaux trains Celestia à affronter des températures extrêmes")).toEqual([]);
    expect(tickersIn("Pourquoi le cours de Celestia baisse-t-il de 10,6 % aujourd’hui ?")).toEqual(["TIA"]);
    expect(tickersIn("Celestia vs Avail : Comparatif des Tokens de Data Availability")).toEqual(["TIA"]);
    expect(tickersIn("peaq lance un nouveau réseau DePIN")).toEqual(["PEAQ"]);
    expect(isJunk({ title: "Convertir 1 INJ (Injective) en MDL (Leu moldave)", source: "Bybit" })).toBe(true);
    expect(isJunk({ title: "Trains Celestia", source: "https://horticulture-abadie-pyrenees.com/" })).toBe(true);
    expect(isJunk({ title: "Injective Became an SEC-Registered Transfer Agent", source: "TradingView" })).toBe(false);
    expect(cleanText("<p>A&nbsp;&amp;&#160;B</p>")).toBe("A & B");
  });

  it("fusion : favoris seulement, 7 jours, sans doublon de lien ni de titre, le plus récent d'abord", () => {
    const now = new Date("2026-10-12T22:00:00Z");
    const fresh = [
      ...parseRss(GOOGLE, { name: "G", aggregator: true }),
      { title: "Bitcoin : les ETF enregistrent une nouvelle semaine d’entrées", url: "https://autre.fr/x", source: "Autre", published_at: "2026-10-12T09:00:00Z", excerpt: null },
    ];
    const previous = { items: [{ title: "Arbitrum : vieux titre", url: "https://v.fr", source: "V", published_at: "2026-10-01T00:00:00Z", tickers: ["ARB"] }, { title: "Injective : mise à jour", url: "https://i.fr", source: "I", published_at: "2026-10-11T07:00:00Z", tickers: ["INJ"] }] };
    const items = mergeFeed(previous, fresh, now);
    expect(items.map((i) => i.source)).toEqual(["Les Echos", "I"]);
    expect(items[0].tickers).toEqual(["BTC"]);
  });

  it("plafonds par sujet : 12 titres bitcoin/ether seuls au plus, 5 par autre favori", () => {
    const now = new Date("2026-10-12T22:00:00Z");
    const mk = (i, title) => ({ title: `${title} n°${i}`, url: `https://m.fr/${title.length}/${i}`, source: "M", published_at: new Date(now.getTime() - i * 60000).toISOString(), excerpt: null });
    const fresh = [...Array.from({ length: 20 }, (_, i) => mk(i, "Bitcoin recule")), ...Array.from({ length: 8 }, (_, i) => mk(i, "Chainlink et Bitcoin"))];
    const items = mergeFeed(null, fresh, now);
    expect(items.filter((x) => x.tickers.includes("LINK"))).toHaveLength(5);
    expect(items.filter((x) => !x.tickers.includes("LINK"))).toHaveLength(12);
  });
});
