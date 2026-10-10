# Connecteur CoinMarketCap

**En bref** : une routine dédiée (`coinmarketcap-quotidien`) fait 1 appel par jour et écrit
`data/crypto-global.json`. Le site et l'Assistant l'affichent déjà dès que le fichier existe.
Activation : l'utilisateur crée la routine (`docs/routines/coinmarketcap-quotidien.md`).

## Pourquoi une routine dédiée

Un outil de connecteur peut bloquer une routine automatique (CoinGecko : 55 cycles perdus en
août). Blockscout, lui, marche en automatique (prouvé le 10/10). Une routine à part, avec son propre
fichier, teste CoinMarketCap **sans aucun risque pour les autres routines**.

## Ce que fournit le connecteur (testé le 10/10/2026)

| Outil | Contenu | Utilisé ? |
|---|---|---|
| `get_global_metrics_latest` | Saison des altcoins, positions ouvertes, financement, liquidations BTC, encours ETF (~5,5 Ko) | **Oui** — routine dédiée |
| `get_crypto_metrics` | Répartition des détenteurs d'un actif (baleines) | Plus tard : favoris |
| `get_crypto_latest_news` | ≤ 10 articles pour un actif, lourd en quota | Seulement si les actualités sont rétablies (P2) |
| `trending_crypto_narratives` | Thèmes en vogue | Plus tard : opportunités |
| `execute_skill` | Analyses composées, dont taux 10 ans US et flux nets ETF | **Non : facturé à chaque exécution**, décision de l'utilisateur |

À ne pas confondre : l'encours des ETF n'est pas un flux ; la peur-cupidité CoinMarketCap (57 le
10/10) n'est pas celle d'alternative.me déjà affichée (64).

## Étapes suivantes

1. Routine dédiée réussie 3 jours de suite (`data/crypto-global.json` daté du jour).
2. Puis, une routine à la fois et après accord : favoris (`get_crypto_metrics`), opportunités
   (`trending_crypto_narratives`) — toujours avec l'appel en dernière étape, après le commit habituel.
