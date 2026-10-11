# Connecteur CoinMarketCap

**En bref** : une routine dédiée (`coinmarketcap-quotidien`) relève chaque jour le marché et
l'analyse technique des 15 favoris (`data/crypto-global.json`, `data/cmc-favoris.json`). Le site
(fiche de chaque favori) et l'Assistant s'en servent. Activation : `docs/routines/coinmarketcap-quotidien.md`
(routine à créer par l'utilisateur, facultative).

**Depuis le 11/10/2026**, l'analyse technique des favoris (MM200, RSI, MACD) est calculée chaque
soir sans quota par le robot GitHub `technical-daily` (`data/technical-favoris.json`) : c'est elle
que lit le cycle des verdicts. CoinMarketCap reste utile pour ce que le robot n'a pas : levier,
financement, liquidations, saison des altcoins (`get_global_metrics_latest`), et a servi à
recouper les calculs du robot.

## Pourquoi une routine dédiée

Un outil de connecteur peut bloquer une routine automatique (CoinGecko : 55 cycles perdus en
août). Blockscout, lui, marche en automatique (prouvé le 10/10). Une routine à part, avec son propre
fichier, teste CoinMarketCap **sans aucun risque pour les autres routines**.

## Ce que fournit le connecteur (testé le 10/10/2026)

| Outil | Contenu | Utilisé ? |
|---|---|---|
| `get_global_metrics_latest` | Saison des altcoins, positions ouvertes, financement, liquidations BTC, encours ETF (~5,5 Ko) | **Oui** — routine dédiée |
| `get_crypto_quotes_latest` | 15 favoris en 1 appel (~9 Ko) : cours, évolutions 1 h → 1 an, volume, offre | **Oui** — routine dédiée |
| `get_crypto_technical_analysis` | 1 actif par appel (~0,7 Ko) : RSI 7/14/21, MM 7/30/200, MACD, Fibonacci, pivot | **Oui** — routine dédiée, 15 appels |
| `get_crypto_metrics` | Répartition des détenteurs d'un actif (baleines) | Plus tard : favoris |
| `get_crypto_latest_news` | ≤ 10 articles pour un actif, lourd en quota | Seulement si les actualités sont rétablies (P2) |
| `trending_crypto_narratives` | Thèmes en vogue | Plus tard : opportunités |
| `execute_skill` | Analyses composées, dont taux 10 ans US et flux nets ETF | **Non : facturé à chaque exécution**, décision de l'utilisateur |

À ne pas confondre : l'encours des ETF n'est pas un flux ; la peur-cupidité CoinMarketCap (57 le
10/10) n'est pas celle d'alternative.me déjà affichée (64).

## Étapes suivantes

1. Routine dédiée réussie 3 jours de suite (`data/cmc-favoris.json` daté du jour).
2. Cycle des verdicts : enregistre `technical_at_issue` (robot) sans changer sa règle de décision ;
   après assez de verdicts résolus, mesurer si un RSI en surachat/survente prédit l'issue.
3. Plus tard, après accord : répartition des détenteurs (`get_crypto_metrics`) pour les favoris,
   thèmes en vogue (`trending_crypto_narratives`) pour les opportunités — dans la routine dédiée.
