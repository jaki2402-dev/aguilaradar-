# Routine : `aguilaradar-coinmarketcap-quotidien`

Copie de référence versionnée des instructions de la routine : modifier CE fichier d'abord, puis
reporter le texte dans la routine.

- **Rôle unique** : relever chaque jour les données CoinMarketCap du marché et des 15 favoris →
  `data/crypto-global.json` (levier, saison des altcoins, encours ETF) et `data/cmc-favoris.json`
  (cours, évolutions 24 h → 1 an, RSI, moyennes 7/30/200 j, MACD, Fibonacci, pivot). Fichiers
  possédés par cette seule routine, écrasés à chaque passage.
- **Pourquoi** : les verdicts n'utilisaient que les évolutions 24 h / 7 j / 30 j. Exemple réel du
  10/10 : CTSI émis ACHAT (« technique haussière ») avec un RSI 14 j à 71, en surachat, et un cours
  30 % au-dessus de sa moyenne 200 j — rien de cela n'était visible pour la routine.
- **Réglages** : dépôt `jaki2402-dev/aguilaradar-` ; connecteur **CoinMarketCap uniquement** ;
  tous les jours à 07h20 UTC (9h20 heure de Paris l'été, 8h20 l'hiver) ; session neuve à chaque
  exécution.
- **Budget** : 1 exécution/jour (~15/jour au total, le plafond de `CLAUDE.md`), 17 appels d'outil.
- **Fiabilité** : la routine enregistre les réponses **brutes** ; `scripts/cmc-snapshot.py` extrait
  et contrôle les chiffres (RSI hors 0-100 écarté, analyse technique écartée si sa moyenne 7 j est
  incompatible avec le cours — protège d'une réponse recopiée sous le mauvais identifiant). Ids des
  15 favoris vérifiés le 10/10/2026, dans le script (`--ids`).
- **État** : préparée le 10/10/2026, à créer par l'utilisateur. Active quand
  `data/cmc-favoris.json` existe sur `origin/main`. (Une 1re version ne relevait que le marché via
  7 valeurs recopiées et `scripts/write-crypto-global.py` ; si elle a été collée, la remplacer.)

## Instructions (texte exact à coller)

```
Routine aguilaradar-coinmarketcap-quotidien. Dépôt jaki2402-dev/aguilaradar- (branche main). Rôle unique : relever chaque jour les données CoinMarketCap du marché et des 15 favoris et les écrire dans data/crypto-global.json et data/cmc-favoris.json. Ne modifie aucun autre fichier et ne lis aucun gros fichier data/*.json.

Outils autorisés : UNIQUEMENT get_global_metrics_latest, get_crypto_quotes_latest et get_crypto_technical_analysis du connecteur CoinMarketCap. Jamais execute_skill (facturé), aucun autre outil CoinMarketCap, aucun outil CoinGecko, Alpha Vantage ou Economic Index. Si le connecteur est absent, arrête-toi sans rien écrire et dis « CoinMarketCap indisponible ».

1. git fetch -q origin main && git checkout -q -B cmc-quotidien origin/main && mkdir -p /tmp/cmc, puis python3 scripts/cmc-snapshot.py --ids (ligne 1 : les 15 identifiants ; ligne 2 : ticker=identifiant).
2. Appelle get_global_metrics_latest (sans paramètre) et enregistre sa réponse BRUTE, telle quelle, dans /tmp/cmc/global.json.
3. Appelle get_crypto_quotes_latest avec id = la ligne 1 (une seule chaîne, sans espace) et enregistre sa réponse brute dans /tmp/cmc/quotes.json.
4. Pour chacun des 15 identifiants : appelle get_crypto_technical_analysis (id = cet identifiant, sans includeFields) et enregistre sa réponse brute dans /tmp/cmc/ta-<identifiant>.json. Si l'outil répond « erreur 1008 » (limite par minute) : sleep 60 puis un seul nouvel essai, sinon passe au suivant.
5. Lance python3 scripts/cmc-snapshot.py /tmp/cmc. Le script fait toutes les conversions et vérifications : ne recopie, ne calcule et n'invente aucune valeur toi-même.
6. python3 -m json.tool sur chaque fichier écrit (> /dev/null), puis git add data/crypto-global.json data/cmc-favoris.json, git commit -m "CoinMarketCap : marché et favoris du JJ/MM/AAAA" et git push origin HEAD:main. Si le push est refusé : git pull --rebase -q origin main et réessaie (3 essais maximum, jamais de push forcé).
7. Vérifie avec git log origin/main -1 --oneline que ton commit est sur main. Termine par une phrase : combien de favoris ont une analyse technique.
```

## Vérifier qu'elle marche

```
git fetch -q origin main && git show origin/main:data/cmc-favoris.json | python3 -c "import json,sys;d=json.load(sys.stdin);a=d['assets'];print(d['as_of'], len(a), 'favoris,', sum(1 for x in a.values() if x['technical']), 'avec analyse technique')"
```

- Date du jour et 15 favoris → réussi ; sur le site, fiche d'un favori → « Analyse technique
  CoinMarketCap ».
- Fichier absent ou ancien → ouvrir la dernière exécution dans claude.ai : si elle attend une
  autorisation d'outil, CoinMarketCap ne passe pas en automatique → désactiver la routine. Aucune
  autre routine n'est touchée.
