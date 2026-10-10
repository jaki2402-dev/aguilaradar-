# Connecteur CoinMarketCap — ce qu'il apporte et comment il est branché

Connecteur ajouté par l'utilisateur le 10/10/2026. Ce document dit ce qui a été **testé**, ce qui
est **branché**, et la marche à suivre pour aller plus loin sans casser les routines.

## Pourquoi pas « partout d'un coup »

Un outil de connecteur appelé par une routine qui tourne seule peut rester bloqué sur une demande
d'autorisation que personne ne valide : la routine ne commite alors plus rien. C'est arrivé avec
CoinGecko (55 cycles perdus du 12 au 17/08, contexte marché figé 6 jours fin août). Mais ce n'est
pas systématique : Blockscout fonctionne dans `favoris-quotidien` (prouvé sur les données du 10/10).
Seul un essai réel en exécution automatique dit de quel côté tombe CoinMarketCap — d'où un pilote
sur une seule routine, avec l'appel placé **après** le travail habituel déjà enregistré.

## Ce que fournit le connecteur (testé le 10/10/2026, session interactive)

| Outil | Contenu | Intérêt pour AguilaRadar |
|---|---|---|
| `get_global_metrics_latest` | Tableau du marché entier (~5,5 Ko) : saison des altcoins, positions ouvertes, financement moyen, liquidations BTC, encours des ETF BTC/ETH, peur-cupidité CMC, dominance. Valeurs en texte (« 378.07 B »). | **Branché** (pilote, voir plus bas). Le portefeuille est surtout composé d'altcoins : la saison des altcoins et le levier du marché le concernent directement. |
| `get_global_crypto_derivatives_metrics` | Dérivés : positions ouvertes, financement, liquidations BTC longues/courtes. Aucun horodatage. | Doublon partiel du précédent, non branché. |
| `get_crypto_metrics` | Répartition des détenteurs d'un actif (baleines, concentration). | Phase 2 : `favoris-quotidien` (`onchain_signal`). |
| `get_crypto_latest_news` | ≤ 10 articles pour UN actif, ~2 000 caractères chacun. | Phase 2 seulement si l'utilisateur rétablit les actualités (P2) — coûteux en quota. |
| `trending_crypto_narratives` | Thèmes de marché en vogue. | Phase 2 possible : `opportunites-quotidien`. |
| `get_upcoming_macro_events` | Événements à venir extraits d'articles (dizaines de Ko, non officiel). | Non : trop lourd, pas un vrai calendrier. |
| `execute_skill` (analyses composées) | Ex. `macro_financial_conditions` (taux 10 ans US, inflation), `btc_etf_institutional_demand` (flux nets des ETF). | Comblerait P3, mais **facturé à chaque exécution** (prix non affiché) : décision de l'utilisateur. |

Limites relevées : l'encours des ETF n'est **pas** un flux (la différence entre deux encours mêle
flux et variation du prix) ; la peur-cupidité CMC (57 le 10/10) n'est pas celle d'alternative.me
déjà affichée (64) — deux indices différents, ne pas les mélanger.

## Pilote : `aguilaradar-marche-quotidien` → bloc `crypto_global`

Une seule exécution par jour alimente tout le reste : le site (Accueil → Contexte marché élargi),
l'Assistant, et les routines qui lisent déjà `data/market-context.json` (cycle des verdicts, résumé).

Forme écrite par `scripts/write-crypto-global.py` (la routine recopie les valeurs telles
qu'affichées, le script convertit — jamais de conversion « de tête ») :

```json
"crypto_global": {
  "as_of": "<ISO UTC du relevé>",
  "altcoin_season_index": 64,
  "open_interest_usd": 378070000000,
  "open_interest_change_7d_pct": -12.34,
  "funding_rate_avg_pct": 0.0042474,
  "btc_liquidations_24h_usd": 3670000,
  "btc_etf_aum_usd": 108820000000,
  "eth_etf_aum_usd": 14600000000,
  "source": "...", "note": "..."
}
```

### Ce que l'utilisateur doit faire (2 gestes)

1. Dans claude.ai, ouvrir la routine `aguilaradar-marche-quotidien` (liste des routines, ou
   `claude.ai/code/routines/trig_01CW274AabmgPtsRgwuWyoBb` — identifiant relevé en août, à
   revérifier) et **ajouter le connecteur CoinMarketCap** à cette routine seulement.
2. **Coller à la toute fin de ses instructions** le texte ci-dessous, sans rien modifier d'autre.

```
ÉTAPE FINALE COINMARKETCAP (pilote du 10/10/2026, voir docs/coinmarketcap.md). À faire UNIQUEMENT après que ton travail habituel sur data/market-context.json est commité ET fusionné dans main. Cette étape fait exception à toute interdiction générale des outils mcp__ écrite plus haut, pour CET outil CoinMarketCap seulement — les interdictions CoinGecko / Alpha Vantage / Economic Index restent valables.
1. Appelle une seule fois l'outil get_global_metrics_latest du connecteur CoinMarketCap (aucun paramètre). S'il n'apparaît pas dans tes outils, ne fais rien de plus : écris « CoinMarketCap indisponible » dans ton résumé final et arrête-toi.
2. Recopie TELLES QUELLES ces 7 valeurs de la réponse (texte exact, ou "" si absente) : rotation.altcoin_season.current.index ; leverage.open_interest.total.current ; leverage.open_interest.total.percent_change.7d ; leverage.funding_rate.average.current ; leverage.liquidations.btc.total_usd24h ; trad_fi_flows.etf_aum.btc.current ; trad_fi_flows.etf_aum.eth.current.
3. Lance depuis la racine du dépôt : python3 scripts/write-crypto-global.py "<v1>" "<v2>" "<v3>" "<v4>" "<v5>" "<v6>" "<v7>" puis python3 -m json.tool data/market-context.json > /dev/null.
4. Commite (« Contexte marché : levier et rotation CoinMarketCap du JJ/MM ») et fusionne dans main avec la même procédure en 2 étapes que ton travail habituel.
N'utilise AUCUN autre outil CoinMarketCap, et jamais execute_skill (facturé).
```

### Comment savoir si le pilote marche

Après l'exécution de 08:40 UTC (dès le 11/10 si le texte est collé avant) :

```
git fetch -q origin main && git show origin/main:data/market-context.json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['last_computed_at'], (d.get('crypto_global') or {}).get('as_of'))"
```

- Les deux dates sont du jour → **réussi**. Sur le site : nouvelle rangée « Saison des altcoins ».
- `last_computed_at` du jour mais `crypto_global` absent ou ancien → le travail habituel est sauf,
  l'étape CoinMarketCap a bloqué ou échoué : retirer le connecteur et le texte collé.
- `last_computed_at` ancien → la routine elle-même n'a pas abouti : retirer le texte collé et
  enquêter avant toute nouvelle tentative.

**3 jours réussis de suite** → mettre à jour `CLAUDE.md` et `docs/feuille-de-route.md`, puis
passer à la phase 2, une routine à la fois, avec la même méthode (appel en dernière étape, vérifié).
