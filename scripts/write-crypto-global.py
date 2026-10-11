# data/crypto-global.json, écrit par la routine dédiée aguilaradar-coinmarketcap-quotidien à partir
# du connecteur CoinMarketCap (voir docs/coinmarketcap.md). Fichier d'état courant (écrasé à chaque
# passage), possédé par cette seule routine. Lancé depuis la racine du dépôt.
# Usage : python3 scripts/write-crypto-global.py SAISON OI OI_7J FINANCEMENT LIQ_BTC_24H ETF_BTC ETF_ETH
# Chaque argument = la valeur affichée TELLE QUELLE par get_global_metrics_latest (ex. "378.07 B",
# "-12.34%", "+0.0042474%", "64"), ou "" si absente. Le script convertit, jamais la routine.
import datetime, json, re, sys

MULT = {"T": 1e12, "B": 1e9, "M": 1e6, "K": 1e3, "": 1}

def num(s):
    m = re.fullmatch(r"([+-]?\d+(?:\.\d+)?)\s*([TBMK]?)\s*%?", s.replace(",", "").strip())
    if not m:
        return None
    value = float(m.group(1)) * MULT[m.group(2)]
    return round(value) if MULT[m.group(2)] > 1 else value

a = (sys.argv[1:] + [""] * 7)[:7]
season = num(a[0])
values = [num(v) for v in a]
if all(v is None for v in values):
    sys.exit("Aucune valeur CoinMarketCap exploitable : data/crypto-global.json laissé tel quel.")
path = "data/crypto-global.json"
block = {
    "as_of": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "altcoin_season_index": int(season) if season is not None and 0 <= season <= 100 else None,
    "open_interest_usd": num(a[1]),
    "open_interest_change_7d_pct": num(a[2]),
    "funding_rate_avg_pct": num(a[3]),
    "btc_liquidations_24h_usd": num(a[4]),
    "btc_etf_aum_usd": num(a[5]),
    "eth_etf_aum_usd": num(a[6]),
    "source": "CoinMarketCap, outil get_global_metrics_latest (connecteur MCP)",
    "note": "Saison des altcoins et encours ETF : relevé quotidien de 00:00 UTC ; positions ouvertes et financement : instantané au moment du relevé.",
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(block, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(json.dumps(block, ensure_ascii=False))
