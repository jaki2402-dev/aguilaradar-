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
| Tests (`npm test`) | 10/10 | 722/722 |

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
| P10 | **CoinMarketCap : routine dédiée prête, pas encore créée.** Elle relèvera chaque jour le marché ET l'analyse technique des 15 favoris (RSI, moyennes 200 j, MACD, évolutions jusqu'à 1 an). Le site (fiche de chaque favori) et l'Assistant s'en servent déjà dès que les fichiers existent. | **Toi** | Créer `aguilaradar-coinmarketcap-quotidien` avec le texte de `docs/routines/coinmarketcap-quotidien.md` (nouvelle version du 10/10 au soir). |
| P13 | **Les verdicts n'utilisent aucun indicateur technique** (seulement les évolutions 24 h / 7 j / 30 j). Exemple réel : CTSI émis ACHAT le 10/10 avec un RSI à 71 (surachat), non mentionné. | **Toi**, puis session | Après P10 : coller l'ajout du 10/10 (2) en fin d'instructions de `aguilaradar-cycle-2h`. Les verdicts enregistreront l'analyse CoinMarketCap sans changer leur règle ; à mesurer après le 20/10. |
| P11 | **Résumés d'une phrase par les routines : textes prêts, pas encore collés.** Le site affiche déjà un champ `resume` en tête (verdicts, actualités, régime, notes du contexte marché, thèses des favoris) dès qu'il existe. | **Toi** | Coller chaque texte en fin d'instructions de sa routine : `cycle-2h`, `marche-quotidien`, `favoris-quotidien` (section « Ajout du 10/10/2026 » de `docs/routines/cycle-2h-verdict.md`, `marche-quotidien.md`, `favoris-quotidien.md`). Une session vérifie ensuite qu'un `resume` apparaît sur `origin/main`. |

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
| 10/10 | Textes trop longs : le raisonnement d'un verdict commençait par de la tenue de compte, l'essentiel n'apparaissait pas. | Résumé exact tiré des données du verdict (lectures technique/fondamentale/macro + 3 signaux clés), analyse complète derrière « Lire l'analyse complète » (Journal, Portefeuille, fiche détaillée). Actualités et notes en aperçu + « Lire plus ». Date du Journal lisible. Vérifié dans Chromium à 390 px sur les vraies données. |
| 10/10 | Badge VENTE sous le seuil d'accessibilité (4,11-4,52 pour 4,5). | Rouge `#f87171` : 5,08 au pire. |

## Journal des sessions (le plus récent en haut)

- **10/10/2026 (nuit)** — Priorité de l'utilisateur : de meilleures analyses grâce à CoinMarketCap. Testé :
  analyse technique par actif et cours multi-durées. Routine dédiée étendue (script `cmc-snapshot.py`,
  ids vérifiés), bloc dans la fiche des favoris, contexte de l'Assistant, texte pour le cycle des verdicts.
- **10/10/2026 (fin de soirée)** — Demande : textes plus courts, l'essentiel en avant. Résumés de verdicts
  tirés des données (rien d'inventé), aperçus partout ailleurs. Puis, à la demande de l'utilisateur :
  champ `resume` préparé pour 3 routines (site prêt, textes à coller : P11).
- **10/10/2026 (soir)** — Cloudflare et CoinMarketCap connectés par l'utilisateur. CoinMarketCap testé
  (outils gratuits vs analyses facturées), règle MCP de `CLAUDE.md` corrigée (Blockscout marche en
  routine, prouvé ; CoinMarketCap seulement en pilote). Site/Assistant prêts pour `crypto_global`,
  script `scripts/write-crypto-global.py` testé. Sur proposition de l'utilisateur : routine
  CoinMarketCap dédiée avec son propre fichier plutôt qu'une étape ajoutée à `marche-quotidien`.
  Reste : P10 (toi), P5 (prochaine session).
- **10/10/2026** — Création de ce tableau de bord et du lien depuis `CLAUDE.md`. État vérifié sur
  `origin/main`. Corrigés : stats du moteur dans l'Assistant, cours de l'or (robot GitHub),
  synchronisation du relais IA. Vérifié sans suite : la page ne défile pas horizontalement à
  390 px (`documentElement.scrollWidth` = 390, identique avant/après). Tests : 689/689.
  Prochaine session : P1, P6, P8 demandent une session avec l'outil routines.
