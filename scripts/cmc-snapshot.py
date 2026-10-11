# Instantané CoinMarketCap quotidien (routine aguilaradar-coinmarketcap-quotidien, voir
# docs/routines/coinmarketcap-quotidien.md). La routine enregistre les réponses BRUTES des outils
# CoinMarketCap dans un dossier ; ce script en extrait et vérifie les chiffres — jamais la routine.
#
#   python3 scripts/cmc-snapshot.py --ids          -> ids à passer à get_crypto_quotes_latest
#   python3 scripts/cmc-snapshot.py /tmp/cmc       -> écrit data/crypto-global.json et
#                                                     data/cmc-favoris.json (lancé depuis la racine)
#
# Fichiers lus dans le dossier (chacun optionnel) : global.json (get_global_metrics_latest),
# quotes.json (get_crypto_quotes_latest), ta-<id CMC>.json (get_crypto_technical_analysis).
import datetime
import json
import os
import re
import sys

# Ids CoinMarketCap des 15 favoris, vérifiés un par un via search_cryptos le 10/10/2026.
# FLUX = 3029 (slug "zel"), pas l'homonyme FLX (15535) : même piège que zelcash côté CoinGecko.
CMC_IDS = {
    "BTC": 1, "ETH": 1027, "FET": 3773, "GRT": 6719, "TIA": 22861, "CTSI": 5444, "PEAQ": 14588,
    "LINK": 1975, "ONDO": 21159, "JUP": 29210, "LPT": 3640, "AIOZ": 9104, "FLUX": 3029,
    "ARB": 11841, "INJ": 7226,
}
TICKER_BY_ID = {v: k for k, v in CMC_IDS.items()}
MULT = {"T": 1e12, "B": 1e9, "M": 1e6, "K": 1e3, "": 1}
NOW = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def num(value):
    """Nombre CoinMarketCap ("378.07 B", "-12.34%", "63,612.69", 0.5) -> float, sinon None."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = re.fullmatch(r"([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*([TBMK]?)\s*%?", str(value).replace(",", "").strip())
    if not m:
        return None
    v = float(m.group(1)) * MULT[m.group(2)]
    return round(v) if MULT[m.group(2)] > 1 else v


def dig(data, path):
    for key in path:
        if not isinstance(data, dict) or key not in data:
            return None
        data = data[key]
    return data


def load(folder, name):
    path = os.path.join(folder, name)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"{name} illisible, ignoré : {e}", file=sys.stderr)
        return None


def rows_of(data):
    """Les outils CMC renvoient une liste d'objets (0-1 ligne) ou {headers, rows} (2+ lignes)."""
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict) and isinstance(data.get("headers"), list) and isinstance(data.get("rows"), list):
        return [dict(zip(data["headers"], r)) for r in data["rows"] if isinstance(r, list)]
    return []


def global_block(g):
    season = num(dig(g, ["rotation", "altcoin_season", "current", "index"]))
    block = {
        "as_of": NOW,
        "altcoin_season_index": int(season) if season is not None and 0 <= season <= 100 else None,
        "open_interest_usd": num(dig(g, ["leverage", "open_interest", "total", "current"])),
        "open_interest_change_7d_pct": num(dig(g, ["leverage", "open_interest", "total", "percent_change", "7d"])),
        "funding_rate_avg_pct": num(dig(g, ["leverage", "funding_rate", "average", "current"])),
        "btc_liquidations_24h_usd": num(dig(g, ["leverage", "liquidations", "btc", "total_usd24h"])),
        "btc_etf_aum_usd": num(dig(g, ["trad_fi_flows", "etf_aum", "btc", "current"])),
        "eth_etf_aum_usd": num(dig(g, ["trad_fi_flows", "etf_aum", "eth", "current"])),
        "source": "CoinMarketCap, outil get_global_metrics_latest (connecteur MCP)",
        "note": "Saison des altcoins et encours ETF : relevé quotidien de 00:00 UTC ; positions ouvertes et financement : instantané au moment du relevé.",
    }
    return block if any(v is not None for k, v in block.items() if k not in ("as_of", "source", "note")) else None


def technical(ta, price):
    if not isinstance(ta, dict):
        return None
    ma = ta.get("moving_averages") or {}
    t = {
        "rsi7": num(dig(ta, ["rsi", "rsi7"])),
        "rsi14": num(dig(ta, ["rsi", "rsi14"])),
        "rsi21": num(dig(ta, ["rsi", "rsi21"])),
        "sma7": num(ma.get("simple_moving_average_7_day")),
        "sma30": num(ma.get("simple_moving_average_30_day")),
        "sma200": num(ma.get("simple_moving_average_200_day")),
        "ema200": num(ma.get("exponential_moving_average_200_day")),
        "macd_line": num(dig(ta, ["macd", "macdLine"])),
        "macd_signal": num(dig(ta, ["macd", "signalLine"])),
        "macd_histogram": num(dig(ta, ["macd", "histogram"])),
        "pivot": num(ta.get("pivotPoint")),
        "swing_high": num(dig(ta, ["fibonacciLevels", "swingHigh"])),
        "swing_low": num(dig(ta, ["fibonacciLevels", "swingLow"])),
    }
    for k in ("rsi7", "rsi14", "rsi21"):
        if t[k] is not None and not 0 <= t[k] <= 100:
            t[k] = None
    for k in ("sma7", "sma30", "sma200", "ema200", "pivot", "swing_high", "swing_low"):
        if t[k] is not None and t[k] <= 0:
            t[k] = None
    # Garde-fou contre une réponse recopiée pour le mauvais actif : la moyenne sur 7 jours doit
    # rester à ±50 % du cours. Sinon l'analyse technique de cet actif est écartée, pas devinée.
    if price and t["sma7"] and not 0.5 <= t["sma7"] / price <= 1.5:
        return None
    return t if any(v is not None for v in t.values()) else None


def favoris_block(folder):
    quotes = {}
    for row in rows_of(load(folder, "quotes.json")):
        cmc_id = int(num(row.get("id")) or 0)
        if cmc_id in TICKER_BY_ID:
            quotes[cmc_id] = row
    assets = {}
    for ticker, cmc_id in CMC_IDS.items():
        q = quotes.get(cmc_id)
        price = num(q.get("price")) if q else None
        if price is not None and price <= 0:
            price = None
        tech = technical(load(folder, f"ta-{cmc_id}.json"), price)
        if q is None and tech is None:
            continue
        entry = {"cmc_id": cmc_id, "price_usd": price, "rank": None, "change_pct": None, "volume_24h_usd": None, "technical": tech}
        if q:
            rank = num(q.get("rank"))
            entry["rank"] = int(rank) if rank else None
            entry["change_pct"] = {k: num(q.get(f"percent_change_{k}")) for k in ("24h", "7d", "30d", "90d", "1y", "ytd")}
            entry["volume_24h_usd"] = num(q.get("volume_24h"))
        assets[ticker] = entry
    if not assets:
        return None
    return {"as_of": NOW, "source": "CoinMarketCap : get_crypto_quotes_latest + get_crypto_technical_analysis (connecteur MCP), USD", "assets": assets}


def write(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main(argv):
    if argv[1:] == ["--ids"]:
        print(",".join(str(v) for v in CMC_IDS.values()))
        print(" ".join(f"{k}={v}" for k, v in CMC_IDS.items()))
        return 0
    if len(argv) != 2 or not os.path.isdir(argv[1]):
        print(__doc__ or "usage : python3 scripts/cmc-snapshot.py <dossier> | --ids", file=sys.stderr)
        return 2
    folder = argv[1]
    written = []
    g = load(folder, "global.json")
    gb = global_block(g) if isinstance(g, dict) else None
    if gb:
        write("data/crypto-global.json", gb)
        written.append("data/crypto-global.json")
    fb = favoris_block(folder)
    if fb:
        write("data/cmc-favoris.json", fb)
        written.append(f"data/cmc-favoris.json ({len(fb['assets'])} favoris, {sum(1 for a in fb['assets'].values() if a['technical'])} avec analyse technique)")
    if not written:
        print("Aucune donnée CoinMarketCap exploitable : rien n'est écrit.", file=sys.stderr)
        return 1
    print("Écrit : " + " ; ".join(written))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
