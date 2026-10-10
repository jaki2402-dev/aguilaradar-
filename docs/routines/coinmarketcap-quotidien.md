# Routine : `aguilaradar-coinmarketcap-quotidien`

Copie de référence versionnée des instructions de la routine (même principe que les autres
fichiers de ce dossier) : modifier CE fichier d'abord, puis reporter le texte dans la routine.

- **Rôle unique** : relever le tableau de marché CoinMarketCap → `data/crypto-global.json`
  (fichier possédé par cette seule routine, écrasé à chaque passage).
- **Réglages** : dépôt `jaki2402-dev/aguilaradar-` ; connecteur **CoinMarketCap uniquement** ;
  tous les jours à 07h20 UTC (9h20 heure de Paris l'été, 8h20 l'hiver) ; session neuve à chaque
  exécution (jamais persistante : coût).
- **Budget** : 1 exécution/jour, 1 appel d'outil (~5,5 Ko). Fait passer le total d'environ 14 à
  15 exécutions/jour, soit le plafond de `CLAUDE.md` — compensable en fusionnant `sante-quotidien`
  et `verif-fraicheur-quotidien`.
- **Créée le** : préparée le 10/10/2026, à créer par l'utilisateur. Active seulement quand
  `data/crypto-global.json` existe sur `origin/main`.

## Instructions (texte exact à coller)

```
Routine aguilaradar-coinmarketcap-quotidien. Dépôt jaki2402-dev/aguilaradar- (branche main). Rôle unique : relever le tableau de marché CoinMarketCap et l'écrire dans data/crypto-global.json. Ne modifie aucun autre fichier et ne lis aucun gros fichier data/*.json (inutile ici).

1. Appelle UNE seule fois l'outil get_global_metrics_latest du connecteur CoinMarketCap (aucun paramètre). C'est le seul outil de connecteur autorisé : aucun autre outil CoinMarketCap, jamais execute_skill (facturé), aucun outil CoinGecko, Alpha Vantage ou Economic Index. Si l'outil est absent ou en erreur, arrête-toi sans rien écrire et dis « CoinMarketCap indisponible ».
2. Recopie TELLES QUELLES ces 7 valeurs de la réponse (texte exact, ou "" si absente) : rotation.altcoin_season.current.index ; leverage.open_interest.total.current ; leverage.open_interest.total.percent_change.7d ; leverage.funding_rate.average.current ; leverage.liquidations.btc.total_usd24h ; trad_fi_flows.etf_aum.btc.current ; trad_fi_flows.etf_aum.eth.current.
3. git fetch -q origin main && git checkout -q -B cmc-quotidien origin/main, puis lance : python3 scripts/write-crypto-global.py "<v1>" "<v2>" "<v3>" "<v4>" "<v5>" "<v6>" "<v7>" puis python3 -m json.tool data/crypto-global.json > /dev/null. Le script fait toutes les conversions : n'en fais aucune toi-même et n'invente jamais une valeur.
4. git add data/crypto-global.json && git commit -m "CoinMarketCap : levier et rotation du JJ/MM/AAAA" puis git push origin HEAD:main. Si le push est refusé : git pull --rebase -q origin main et réessaie (3 essais maximum, jamais de push forcé).
5. Vérifie avec git log origin/main -1 --oneline que ton commit est bien sur main. Termine par une phrase de résumé.
```

## Vérifier qu'elle marche

```
git fetch -q origin main && git show origin/main:data/crypto-global.json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['as_of'], d['altcoin_season_index'])"
```

- Date du jour → réussi ; sur le site, Accueil → « Contexte marché élargi » → rangée « Saison des
  altcoins ».
- Fichier absent ou date ancienne → ouvrir la dernière exécution de la routine dans claude.ai :
  si elle attend une autorisation d'outil, CoinMarketCap ne passe pas en automatique → désactiver
  la routine. Aucune autre routine n'est touchée dans ce cas.
