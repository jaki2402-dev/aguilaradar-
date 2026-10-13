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

## État vérifié — 12/10/2026 22h50 UTC

Horodatages lus dans les fichiers `data/*.json` sur `origin/main`.

| Brique | Dernière mise à jour | État |
|---|---|---|
| Cycle des verdicts | 12/10 16h17 | OK — 12 en attente ; dernier verdict émis le 10/10 16h20 (les 15 places étaient prises). 3 places libérées le 12/10 19h59 (TIA, GRT, PEAQ résolus) → premiers verdicts de la nouvelle règle attendus au cycle du 13/10 00h15 (P14) |
| Résumé périodique | 12/10 18h06 | OK pour le texte — notifications : voir P1 |
| Opportunités | 12/10 04h10 | OK |
| Contexte marché | 12/10 08h50 | OK — taux 10 ans et stablecoins fournis par le robot GitHub en secours |
| Jauges peur/cupidité, dominance (Action GitHub) | 12/10 22h48 | OK |
| Contexte des favoris | 12/10 08h25 | OK — rotation, plus ancien au 08/10 |
| Santé + fraîcheur | 12/10 09h16 | OK — mais liste de fichiers incomplète (P6) |
| Photo du portefeuille (Action GitHub) | 12/10 22h46 | OK — 21 points ; le point du jour est désormais rafraîchi 4×/jour (36 h sans valeur avant le correctif) |
| Thèse hebdo du portefeuille | 12/10 05h04 | OK |
| Groupe témoin | 04/10 | OK — objectif 8 en attente atteint |
| Actualités (sélection du cycle) | vérifiées 12/10 16h17, contenu inchangé depuis le 05/10 | P2 — compensé par le fil des médias |
| Fil des médias (Action GitHub, `news-feed.json`) | 12/10 22h50 | OK — 4 flux lus sans erreur, 33 titres réels datés, 7 favoris couverts (BTC, ETH, LINK, INJ, TIA, ARB, FET), aucun faux positif |
| Vérification des échéances (Action GitHub `resolve-due`, toutes les heures) | 12/10 20h00 | OK — TIA juste (+23,08 %), GRT faux (−9,4 %), PEAQ faux (−2,55 %) |
| Analyse technique + laboratoire (Action GitHub `technical-daily`) | 12/10 02h32 | OK |
| On-chain du bitcoin (Action GitHub) | jour complet du 11/10 | OK |
| Tests (`npm test`) | 12/10 | 826/826 |

## Problèmes ouverts

| # | Constat (preuve) | Qui | Prochaine action |
|---|---|---|---|
| P1 | **Notifications du résumé et « Avis du jour » arrêtés.** Aucune entrée `avis_du_jour` dans `alerts.json` depuis le 14/09 00h40. Cause documentée le 05/10 : le prompt de la routine digest utilise une ancienne clé de notification ; le nouveau prompt préparé n'a jamais été collé. | Session avec l'outil routines + **Toi** | Relire le prompt actuel (`get_trigger`), préparer la version corrigée, tu la colles, puis re-vérifier. |
| P2 | **Alertes d'actualité arrêtées depuis le 13/09** (`actualite_*`), et aucune nouvelle actualité ajoutée par le cycle depuis le 05/10. Arrêt volontaire lors de l'allègement du 14-15/09 pour économiser le quota. **Compensé le 12/10** : le robot GitHub relève 4×/jour les titres réels des médias crypto citant un favori (« Fil des médias », sans quota). | **Toi** | Rien d'urgent. Décider plus tard si les alertes d'actualité doivent revenir (coûte du quota). |
| P3 | **Taux 10 ans US et flux ETF vides** dans `market-context.json` depuis au moins le 08/10 : la routine ne trouve pas de chiffre daté par recherche web. **Or : corrigé le 10/10** (voir journal). | Session + **Toi** | 10 ans : tester une source officielle gratuite (Trésor US, FRED) depuis le robot GitHub — injoignables depuis la session du 10/10. CoinMarketCap fournit les deux (taux 10 ans, flux nets ETF) mais via des analyses **facturées à chaque exécution** : à toi de décider (voir `docs/coinmarketcap.md`). |
| P6 | **Le contrôle de santé ne vérifie que 9 des 15 fichiers de données** (note du 10/10 08h51 : « Les 9 fichiers data/*.json »). Non couverts : `digest`, `market-gauges`, `onchain-history`, `portfolio`, `portfolio-history`, `portfolio-thesis`. | Session avec l'outil routines + **Toi** | Mettre à jour la liste dans le prompt `sante-quotidien`. |
| P7 | **3 routines gardent toute leur mémoire d'une exécution à l'autre** (verif-fraicheur, opportunités, briefing-email) : 274 k à 491 k tokens de contexte mesurés le 06/10, bien plus coûteux qu'une session neuve. | Session avec l'outil routines + **Toi** | Convertir une par une, en vérifiant après chaque conversion. |
| P8 | **Seuls 4 prompts de routines sur environ 11 sont recopiés dans `docs/routines/`** : les autres sont invisibles pour une session qui n'a pas l'outil routines. C'est le principal trou de mémoire entre sessions. | Session avec l'outil routines | Recopier chaque prompt actuel (`get_trigger`) dans `docs/routines/<nom>.md`, sans secret (clé privée exclue). |
| P9 | **Mail du matin** : le prompt corrigé du 05/10 (jauges fraîches) n'a probablement pas été collé. Non vérifié : le mail ne laisse aucune trace dans le dépôt. | Session avec l'outil routines | Vérifier avec `get_trigger`. |
| P16 | **CoinMarketCap automatique (facultatif)** : le robot sait recouper chaque jour cours et offre des 15 favoris avec CoinMarketCap (code prêt et testé, 11/10). Il faut une clé gratuite. | **Toi**, si tu veux | 1) Créer un compte gratuit sur pro.coinmarketcap.com (plan Basic) et copier la clé API. 2) Sur GitHub : dépôt `aguilaradar-` → Settings → Secrets and variables → Actions → New repository secret, nom `CMC_API_KEY`, valeur = la clé. Rien d'autre : le robot l'utilise dès le soir suivant. |
| P15 | **Routine `horizons-6h` devenue inutile** : le robot `resolve-due` fait son travail sans quota (essai réel réussi le 11/10). Une session ne peut pas la désactiver (refus du système). | **Toi** | Désactiver `aguilaradar-horizons-6h` : claude.ai/code/routines/trig_012L3zXByo7gQXCfAYQsrWhn. Sans urgence : elle ne trouve plus rien à faire. |
| P10 | **CoinMarketCap : routine dédiée facultative.** Depuis le 11/10, l'analyse technique des favoris vient du robot GitHub (sans quota). CoinMarketCap n'apporterait plus que le levier, le financement, les liquidations et la saison des altcoins. | **Toi**, si tu le souhaites | Créer `aguilaradar-coinmarketcap-quotidien` avec le texte de `docs/routines/coinmarketcap-quotidien.md`. Rien ne casse sans elle. |
| P14 | **Nouvelle règle du moteur en conditions réelles** (choisie par l'utilisateur le 11/10) : VENTE si RSI ≥ 70, sinon ACHAT. **Premiers verdicts vérifiés le 13/10 00h40** : GRT, TIA, PEAQ en ACHAT, conformes (règle, proposition du robot, RSI des clôtures quotidiennes, 0 anomalie). Échéance le 20/10 00h20. | Session à partir du 20/10 | Suivre la colonne « Test réel » (onglet Moteur) ; changer de règle seulement si une autre la bat sur ≥ 15 verdicts. |

## Rendez-vous

- **20/10/2026** — rappel `corr-20260921` : juger la règle de sélection ACHAT/ATTENTE/VENTE une fois
  résolus les 7 verdicts haussier→ACHAT du 05/10 (détail dans `docs/journal-technique.md`, 06/10).
  Puis P14 : correction de la règle à partir des verdicts portant `technical_at_issue`.

## Ce qu'une session ne peut pas faire seule

- Modifier le prompt d'une routine : il faut ton accord, et souvent que tu colles toi-même le texte
  dans claude.ai (l'outil le refuse depuis une autre session). **Sauf** cycle des verdicts, marché et
  favoris : leur prompt renvoie à `docs/routines/*.md` sur main, qu'une session peut modifier directement.
- Vérifier ce qui tourne réellement sur Cloudflare : connecteur à autoriser par toi.
- Compter les routines en direct : seulement depuis une session qui a l'outil routines
  (`list_triggers`).

## Résolu

| Date | Problème | Preuve |
|---|---|---|
| 11/10 | On-chain du bitcoin figé depuis le 04/10 (la routine ne pouvait pas joindre blockchain.info ni DefiLlama). | Robot `onchain-btc` (GitHub Action price-alerts) : dernier jour complet, sans doublon ; spec favoris-quotidien : bitcoin retiré. Tests. |
| 11/10 | Trésor US 10 ans vide sur le site, tendance 7 j des stablecoins vide. | Robot market-gauges : FRED DGS10 (CSV public) et DefiLlama, affichés en secours quand la routine n'a rien de daté. Tests. |
| 11/10 | Décimales à l'anglaise dans le contexte marché (« 4.14 % »). | Format français partout dans ces cases. |
| 11/10 | P5 : correctif du relais IA non vérifié sur Cloudflare. | `workers_list` : worker `aguilaradar-assistant-ia` modifié le 10/10 à 22h17 UTC, juste après l'envoi du correctif. |
| 11/10 | Historique du portefeuille « en retard » : dernier point daté 10/10 (en fait la valeur du 09 au soir), 05/10 et 10/10 manquants. Cause : tâche GitHub du soir lancée 3-5 h en retard, après minuit, donc datée du lendemain ; le passage suivant trouvait la date prise et n'ajoutait rien (run #8 du 10/10 à 23h47 : succès mais aucun point). | Date = jour représenté (passage avant 6 h UTC → veille), tâche avancée à 18h17 UTC, seuil d'alerte du site 36 h / 60 h. Tests avec les heures réelles des passages. Point du 11/10 ajouté. |
| 11/10 | Les verdicts n'utilisaient aucun indicateur technique (CTSI émis ACHAT avec un RSI à 71, non signalé). | Robot GitHub quotidien sans quota (`technical-favoris.json`, 15/15 au 1er passage réel). Le cycle lit sa spec sur main (vérifié par `list_triggers`) : il enregistre `technical_at_issue` et signale les contradictions dès le 11/10 08h15. Fiche, comparatif des 15, onglet Moteur, Assistant. 18 tests, vérifié à 390 px. |
| 11/10 | Résumés d'une phrase « à coller » jamais actifs. | Inutile de coller : les 3 routines lisent leur spec sur main. Sections rendues actives le 10/10 à 23h10 ; à confirmer : un `resume` sur `origin/main` après le prochain passage. |
| 10/10 | L'Assistant citait des stats du moteur figées au 05/10 (25,93 % sur 81) au lieu du calcul en direct de l'onglet Moteur. | Même calcul partagé ; sur les données réelles l'Assistant dit « 97 émis, 82 vérifiés, 25,6 % ». 3 tests. |
| 10/10 | Cours de l'or vide sur le site et pour l'IA. | Le robot GitHub (sans quota) relève PAX Gold + Tether Gold, publié seulement s'ils concordent à 2 % près, affiché comme approximation datée. 6 tests + exécution simulée du script. Premier relevé réel au prochain passage du robot (02h40, 10h40, 14h40 ou 22h40 UTC). |
| 10/10 | Correctif du relais IA jamais poussé vers le dépôt surveillé par Cloudflare. | Poussé ; nouveau test qui échoue sur l'ancienne version et passe sur la nouvelle. Mise en ligne : voir P5. |
| 10/10 | Carte « Flux ETF BTC » : montant en dollars affiché en « Md€ / M€ » et sans signe négatif (invisible tant que la donnée était vide). | Formateur en dollars dédié ; test de régression. |
| 10/10 | Textes trop longs : le raisonnement d'un verdict commençait par de la tenue de compte, l'essentiel n'apparaissait pas. | Résumé exact tiré des données du verdict (lectures technique/fondamentale/macro + 3 signaux clés), analyse complète derrière « Lire l'analyse complète » (Journal, Portefeuille, fiche détaillée). Actualités et notes en aperçu + « Lire plus ». Date du Journal lisible. Vérifié dans Chromium à 390 px sur les vraies données. |
| 10/10 | Badge VENTE sous le seuil d'accessibilité (4,11-4,52 pour 4,5). | Rouge `#f87171` : 5,08 au pire. |

## Journal des sessions (le plus récent en haut)

- **13/10/2026 00h40** — Vérification du cycle de 00h15 : 3 verdicts ACHAT (GRT, TIA, PEAQ) conformes
  à la règle et au robot, 0 anomalie. Trouvé : la vérification « toutes les heures » des échéances
  n'était lancée par GitHub que 3-4×/jour → ajoutée aux robots des alertes et de l'analyse technique.
- **12/10/2026 (nuit, avant le cycle de 00h15)** — Vérification préalable des propositions du robot :
  RSI affiché ≠ RSI de la règle sur les 15 favoris (TIA 72,2 contre 60). Tranché avec les vraies
  clôtures Crypto.com (TIA 59,5, GRT 27,3) : la règle était juste, l'affichage et les alertes RSI non
  (cours de la journée incomplète). Robot, fiche et Assistant alignés sur les clôtures quotidiennes.
- **12/10/2026 (nuit)** — « Tu n'as rien vu à améliorer ? » Tour complet dans un navigateur (mobile et
  ordinateur, chaque fiche dépliée) + contrôles de cohérence sur les vraies données (0 anomalie).
  Corrigé : cartes d'allocation coupées sur mobile et notes on-chain illisibles (adresses, noms d'outils).
- **12/10/2026 (soir)** — Demande : historique du portefeuille 36 h en retard, « tout à jour et autonome ».
  Point du jour rafraîchi à chaque passage du robot des alertes (4×/jour, vérifié : point du 12/10 à
  22h46). Fil des médias automatique (titres réels datés, sans quota) : 1er relevé trop centré sur le
  bitcoin puis faux positifs (Škoda Peaq, trains Celestia) corrigés et vérifiés sur le fichier réel.
- **11/10/2026 (fin d'après-midi)** — Demande : CoinMarketCap en plus, auto-analyse des erreurs, valeur
  prédictive, chiffres réels. Laboratoire (2 350 cas réels) : seuls l'élan du bitcoin et la peur/cupidité
  sont prédictifs sur les 2 périodes ; correction par les erreurs testée et écartée (52,6 → 43,5 %) ;
  confiance par situation (65 % aujourd'hui pour ACHAT). Recoupement CoinMarketCap manuel (cours OK,
  offre divergente JUP/INJ/FLUX) + code automatique prêt (P16).
- **11/10/2026 (après-midi)** — Demande : fiabilité et % plus justes, auto-correction, plus de « Donnée
  insuffisante ». Auto-sélection quotidienne de la règle (testée : fenêtre 30 + marge 5 = aucun faux
  changement), confiance ajustée selon l'élan du bitcoin (Brier 0,300 → 0,279 hors échantillon),
  valorisation et offre par le robot (décomposition du verdict remplie pour les 15 favoris).
- **11/10/2026 (midi)** — Demande : « des verdicts beaucoup plus fiables, pas toujours en attente ». Analyse
  des 82 verdicts (indicateurs à l'émission, deux périodes) ; règle « retour à la moyenne » choisie par
  l'utilisateur ; spec §2 réécrite, `corr-20261011-regle-retour-moyenne`, contrôle de conformité adapté.
- **11/10/2026 (fin de matinée)** — Demande : points 2, 1, 3. (2) Robot `resolve-due` : verdicts au prix
  exact de l'échéance, horizons des opportunités, groupe témoin (échéances du 18/10 orphelines), sans
  quota ; le cycle ne résout plus qu'en secours ; désactivation de `horizons-6h` refusée → P15.
  (1) 4 règles candidates figées avant les issues des 15 verdicts en attente (protocole P14).
  (3) Alertes de bascule technique sur le téléphone (MM200, surachat/survente).
- **11/10/2026 (matin)** — Demande : « améliorer nettement l'analyse ». Robot d'analyse technique quotidien
  (GitHub, zéro quota) + analyse rétrospective des 82 verdicts vérifiés (P14). Découverte : cycle, marché et
  favoris suivent leur spec sur main → résumés et lecture technique actifs sans rien coller. Cycle de 00h15
  manqué pour quota d'usage atteint (pas un bug).

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
