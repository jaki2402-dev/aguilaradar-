# Feuille de route AguilaRadar — tableau de bord unique

Un seul endroit pour savoir **ce qui marche, ce qui est cassé, et qui doit agir**. Remplace les
listes éparpillées dans les résumés de session.

## Mode d'emploi

- **Toi (décideur)** : lis la colonne « Qui » — seules les lignes marquées **Toi** t'attendent.
- **Session interactive (le responsable)** : lire ce fichier en début de session ; en fin de
  session, mettre à jour les statuts et ajouter 2-3 lignes au journal en bas.
- **Routines automatiques** : ne lisent pas ce fichier (coût en tokens, voir `CLAUDE.md`).
- **Règle anti-hallucination** : une ligne n'entre ici qu'avec une **preuve vérifiée sur une
  source réelle** (`origin/main`, test, commande) et sa date. Ce qui n'a pas pu être vérifié est
  écrit « non vérifié », jamais supposé. Le détail technique va dans `docs/journal-technique.md`.

## État vérifié — 10/10/2026 22h UTC

Horodatages lus dans les fichiers `data/*.json` sur `origin/main`.

| Brique | Dernière mise à jour | État |
|---|---|---|
| Cycle des verdicts | 10/10 16h28 | OK — 15 verdicts en attente, aucun en retard |
| Résumé périodique | 10/10 18h06 | OK pour le texte — notifications : voir P1 |
| Opportunités | 10/10 04h09 | OK — 7 actives, 13 archivées |
| Contexte marché | 10/10 08h50 | Partiel — taux 10 ans et flux ETF vides (P3) ; or fourni par le robot GitHub à partir de son prochain passage |
| Jauges peur/cupidité, dominance (Action GitHub) | 10/10 15h56 | OK |
| Contexte des favoris | 10/10 08h23 | OK — rotation, plus ancien au 06/10 |
| Santé + fraîcheur | 10/10 09h16 | OK — mais liste de fichiers incomplète (P6) |
| Photo du portefeuille (Action GitHub) | 10/10 00h17 | OK — 19 points |
| Thèse hebdo du portefeuille | 05/10 | OK (hebdomadaire) |
| Groupe témoin | 04/10 | OK — objectif 8 en attente atteint |
| Actualités | vérifiées 10/10, contenu inchangé depuis le 05/10 | À surveiller (P2) |
| Tests (`npm test`) | 10/10 | 697/697 |

## Problèmes ouverts

| # | Constat (preuve) | Qui | Prochaine action |
|---|---|---|---|
| P1 | **Notifications du résumé et « Avis du jour » arrêtés.** Aucune entrée `avis_du_jour` dans `alerts.json` depuis le 14/09 00h40. Cause documentée le 05/10 : le prompt de la routine digest utilise une ancienne clé de notification ; le nouveau prompt préparé n'a jamais été collé. | Session avec l'outil routines + **Toi** | Relire le prompt actuel (`get_trigger`), préparer la version corrigée, tu la colles, puis re-vérifier. |
| P2 | **Alertes d'actualité arrêtées depuis le 13/09** (`actualite_*`), et aucune nouvelle actualité ajoutée depuis le 05/10 alors que la veille tourne à chaque cycle. Arrêt volontaire lors de l'allègement du 14-15/09 pour économiser le quota. | **Toi** | Décider : rétablir (coûte du quota) ou accepter. |
| P3 | **Taux 10 ans US et flux ETF vides** dans `market-context.json` depuis au moins le 08/10 : la routine ne trouve pas de chiffre daté par recherche web. **Or : corrigé le 10/10** (voir journal). | Session + **Toi** | 10 ans : tester une source officielle gratuite (Trésor US, FRED) depuis le robot GitHub — injoignables depuis la session du 10/10. CoinMarketCap fournit les deux (taux 10 ans, flux nets ETF) mais via des analyses **facturées à chaque exécution** : à toi de décider (voir `docs/coinmarketcap.md`). |
| P5 | **Relais IA : correctif anti-notifications en double poussé le 10/10** (`d0115fa` sur `aguilaradar-assistant-ia`), **mise en ligne non vérifiée**. Le connecteur Cloudflare est autorisé depuis le 10/10 au soir, mais ses outils ne se chargent que dans une **nouvelle** session. | Session | Prochaine session : `workers_get_worker_code` sur `aguilaradar-assistant-ia`, chercher `currentIds` dans le code déployé. |
| P6 | **Le contrôle de santé ne vérifie que 9 des 15 fichiers de données** (note du 10/10 08h51 : « Les 9 fichiers data/*.json »). Non couverts : `digest`, `market-gauges`, `onchain-history`, `portfolio`, `portfolio-history`, `portfolio-thesis`. | Session avec l'outil routines + **Toi** | Mettre à jour la liste dans le prompt `sante-quotidien`. |
| P7 | **3 routines gardent toute leur mémoire d'une exécution à l'autre** (verif-fraicheur, opportunités, briefing-email) : 274 k à 491 k tokens de contexte mesurés le 06/10, bien plus coûteux qu'une session neuve. | Session avec l'outil routines + **Toi** | Convertir une par une, en vérifiant après chaque conversion. |
| P8 | **Seuls 4 prompts de routines sur environ 11 sont recopiés dans `docs/routines/`** : les autres sont invisibles pour une session qui n'a pas l'outil routines. C'est le principal trou de mémoire entre sessions. | Session avec l'outil routines | Recopier chaque prompt actuel (`get_trigger`) dans `docs/routines/<nom>.md`, sans secret (clé privée exclue). |
| P9 | **Mail du matin** : le prompt corrigé du 05/10 (jauges fraîches) n'a probablement pas été collé. Non vérifié : le mail ne laisse aucune trace dans le dépôt. | Session avec l'outil routines | Vérifier avec `get_trigger`. |
| P10 | **CoinMarketCap : pilote prêt, pas encore actif.** Site, Assistant et script de conversion prêts et testés ; il manque l'activation dans la routine `marche-quotidien`. | **Toi** | Les 2 gestes de `docs/coinmarketcap.md` (ajouter le connecteur à cette routine, coller le texte en fin d'instructions). Puis une session vérifie 3 jours de suite avant d'étendre à d'autres routines. |

## Rendez-vous

- **20/10/2026** — rappel `corr-20260921` : juger la règle de sélection ACHAT/ATTENTE/VENTE une fois
  résolus les 7 verdicts haussier→ACHAT du 05/10 (détail dans `docs/journal-technique.md`, 06/10).

## Ce qu'une session ne peut pas faire seule

- Modifier le prompt d'une routine : il faut ton accord, et souvent que tu colles toi-même le texte
  dans claude.ai (l'outil le refuse depuis une autre session).
- Vérifier ce qui tourne réellement sur Cloudflare : connecteur à autoriser par toi.
- Compter les routines en direct : seulement depuis une session qui a l'outil routines
  (`list_triggers`).

## Résolu

| Date | Problème | Preuve |
|---|---|---|
| 10/10 | L'Assistant citait des stats du moteur figées au 05/10 (25,93 % sur 81) au lieu du calcul en direct de l'onglet Moteur. | Même calcul partagé ; sur les données réelles l'Assistant dit « 97 émis, 82 vérifiés, 25,6 % ». 3 tests. |
| 10/10 | Cours de l'or vide sur le site et pour l'IA. | Le robot GitHub (sans quota) relève PAX Gold + Tether Gold, publié seulement s'ils concordent à 2 % près, affiché comme approximation datée. 6 tests + exécution simulée du script. Premier relevé réel au prochain passage du robot (02h40, 10h40, 14h40 ou 22h40 UTC). |
| 10/10 | Correctif du relais IA jamais poussé vers le dépôt surveillé par Cloudflare. | Poussé ; nouveau test qui échoue sur l'ancienne version et passe sur la nouvelle. Mise en ligne : voir P5. |
| 10/10 | Carte « Flux ETF BTC » : montant en dollars affiché en « Md€ / M€ » et sans signe négatif (invisible tant que la donnée était vide). | Formateur en dollars dédié ; test de régression. |

## Journal des sessions (le plus récent en haut)

- **10/10/2026 (soir)** — Cloudflare et CoinMarketCap connectés par l'utilisateur. CoinMarketCap testé
  (outils gratuits vs analyses facturées), règle MCP de `CLAUDE.md` corrigée (Blockscout marche en
  routine, prouvé ; CoinMarketCap seulement en pilote). Site/Assistant prêts pour `crypto_global`,
  script `scripts/write-crypto-global.py` testé. Reste : P10 (toi), P5 (prochaine session).
- **10/10/2026** — Création de ce tableau de bord et du lien depuis `CLAUDE.md`. État vérifié sur
  `origin/main`. Corrigés : stats du moteur dans l'Assistant, cours de l'or (robot GitHub),
  synchronisation du relais IA. Vérifié sans suite : la page ne défile pas horizontalement à
  390 px (`documentElement.scrollWidth` = 390, identique avant/après). Tests : 689/689.
  Prochaine session : P1, P6, P8 demandent une session avec l'outil routines.
