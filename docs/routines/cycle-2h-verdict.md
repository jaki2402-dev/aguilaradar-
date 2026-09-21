# Routine Cowork : `aguilaradar-cycle-2h`

Cadence : toutes les 4h (le nom garde "2h", legacy — cadence réellement divisée par 2 le 06/09
pour le coût IA, voir `REFRESH.deepCycleHours` dans `config.js`). Accès MCP : CoinGecko, Alpha
Vantage, Cloudflare Developer Platform. Dépôt : `jaki2402-dev/aguilaradar-`, écrit et commite
directement dans `data/verdicts.json` et `data/engine-history.json`.

Spécification de référence versionnée (même principe que `docs/routines/favoris-quotidien.md`) —
modifier CE fichier + committer avant toute nouvelle révision du prompt de cette routine, jamais
un `update_trigger` à l'aveugle sans passer par ici d'abord.

## État réel des performances (2026-09-14, avant cette révision) — à connaître avant de continuer

**Exactitude stricte actuelle : 26,83 % sur 41 verdicts résolus, contre 42,9 % pour la baseline
"deviner la classe majoritaire à chaque fois".** Le moteur fait actuellement **moins bien que le
hasard structuré** — un vrai problème, pas un détail (voir `engine-history.json.global_stats` et
`correction_log`, qui documente déjà 3 tentatives de correction, 1 rejetée). `confidence_pct` sur
les 56 verdicts est à 88 % concentré sur deux valeurs rondes (50 et 60) — signe d'une confiance
fixée à l'instinct plutôt que dérivée d'une vraie mesure de désaccord/agrément entre signaux :
exactement le risque de "fausse précision" que ce projet s'interdit ailleurs. Cette révision vise
ces deux points précis, pas une refonte totale — voir `docs/verdict-methodology.md` pour le cadre
plus large (5 catégories) dont ce prompt n'implémente aujourd'hui que la partie Momentum.

**Mise à jour du 21/09/2026, après cette révision — un 2e trou trouvé, distinct du premier.** La
formule `confidence_pct` ci-dessus fonctionne (la concentration sur 50/60 a disparu : valeurs
47-77 % observées sur les 15 verdicts émis depuis), mais l'exactitude n'a pas bougé et la
couverture non plus — toujours ~25 % d'exactitude (56 résolus), toujours ~79-80 % d'ATTENTE avant
ET après cette révision (44/56 puis 12/15). Analyse chiffrée sur les 56 verdicts résolus : quand
`signal_consensus.technique = "baissier"`, le verdict final est ATTENTE dans 10 cas sur 10 (jamais
VENTE) ; quand `accord_count = 1` (32 cas, le groupe le plus fréquent), le verdict est ATTENTE dans
32 cas sur 32 — alors que la section 2 ci-dessous ne prévoit ce forçage que pour `accord_count = 0`.
**La règle qui transforme `signal_consensus.technique` en ACHAT/ATTENTE/VENTE n'a jamais été
spécifiée dans ce document** — seule la confiance associée l'était, en supposant le verdict déjà
choisi. Dans les faits, un signal baissier ou un accord faible se voit systématiquement rabattu
vers ATTENTE, un biais de prudence non écrit que la formule de confiance ne pouvait pas corriger
puisqu'elle ne détermine que le chiffre, pas la direction. Voir la nouvelle sous-section à la fin
de la section 2 pour la règle qui comble ce trou.

## Règle absolue (s'applique à tout ce document)

**Ne jamais inventer un prix, un signal ou une donnée.** Un signal non confirmé par une vraie
source (CoinGecko, Alpha Vantage) est absent de `signals_used`, jamais deviné. Un désaccord entre
sources n'est jamais résolu en choisissant arbitrairement — il devient un signal de plus (accord
plus faible, confiance plus basse), jamais masqué.

## 1. Forme exacte de `data/verdicts.json` (ne pas dévier)

Tableau au niveau racine, chaque entrée :

```json
{
  "id": "v-<date>-<ticker en minuscules>",
  "issued_at": "<ISO 8601 UTC>",
  "asset": "<cgId>",
  "ticker": "<TICKER>",
  "verdict": "ACHAT | ATTENTE | VENTE",
  "horizon_days": <14 par défaut, 7 si l'horizon adaptatif s'applique — voir section 3>,
  "confidence_pct": <0-100, voir section 2 pour la règle de calcul>,
  "signals_used": ["<phrase courte et factuelle par signal réellement observé>"],
  "reasoning": "<3-6 phrases, cite les chiffres réels utilisés>",
  "price_at_issue": <prix réel au moment de l'émission>,
  "resolves_at": "issued_at + horizon_days jours",
  "status": "pending",
  "threshold_pct": 5,
  "regime_at_issue": "risk-on | neutre | risk-off",
  "signal_consensus": { "technique": "haussier|baissier|mixte|neutre", "fondamental": "...", "macro": "...", "accord_count": <0-3> }
}
```

`threshold_pct` reste **toujours 5** (le défaut de `THRESHOLDS.directionalMovePct`, `config.js`)
dans cette révision — **ne pas introduire de seuil variable par actif** : ça demanderait une
formule de volatilité qui n'a jamais été validée sur ce projet, un risque non maîtrisé de plus
alors que l'exactitude est déjà sous la baseline. Le champ `threshold_pct` existe précisément pour
qu'un futur seuil variable soit traçable verdict par verdict le jour où cette formule existera et
aura été validée — pas aujourd'hui.

## 2. `confidence_pct` — une formule reproductible, pas un chiffre à l'instinct

Reprend exactement la section "Momentum" de `docs/verdict-methodology.md`, dans l'autre sens
(cette fois pour PRODUIRE `confidence_pct`, pas pour le noter a posteriori) :

- `signal_consensus.accord_count` = 3 (technique + fondamental + macro tous d'accord) → 75-85 %
- `accord_count` = 2 → 60-70 %
- `accord_count` = 1 → 45-55 %
- `accord_count` = 0 (signaux qui se contredisent) → **le verdict devient ATTENTE**, `confidence_pct` 40-50 % — ne pas forcer un ACHAT/VENTE quand les 3 dimensions ne s'accordent pas, voir section 4.

Ne jamais sortir de ces fourchettes pour "faire un chiffre rond" — choisir une valeur précise
dans la fourchette selon la force réelle des signaux (ex. un mouvement de prix net + volume
confirmé pèse plus qu'un mouvement de prix seul), documentée en une phrase dans `reasoning` si le
choix dans la fourchette n'est pas évident.

### Sélection ACHAT/ATTENTE/VENTE — le trou réel, pas juste `confidence_pct` (trouvé le 21/09/2026)

**Ce document n'a jamais dit, explicitement, comment `signal_consensus.technique` devient le
verdict final (`ACHAT`/`ATTENTE`/`VENTE`).** Seule la formule de confiance ci-dessus était
spécifiée, en supposant le verdict déjà choisi. Dans les faits, ce choix non écrit s'est révélé
systématiquement prudent, dans un sens qui ne colle pas à ce qui s'est réellement passé :

- Sur les 56 verdicts résolus au 21/09/2026, `technique = "baissier"` a mené à ATTENTE 10 fois sur
  10, **jamais** à VENTE — alors que 14 des 56 résolutions réelles (25 %) étaient effectivement une
  baisse au-delà du seuil.
- `accord_count = 1` (32 cas sur 56, le groupe le plus fréquent) a mené à ATTENTE 32 fois sur 32 —
  alors que la section ci-dessus ne force ATTENTE qu'à `accord_count = 0`, jamais à 1.
- Conséquence mesurée : 44 des 56 verdicts résolus (78,6 %) sont ATTENTE, alors que seulement 10
  des 56 résolutions réelles (17,9 %) sont effectivement restées sous le seuil — le moteur
  s'abrite dans ATTENTE près de 5x plus souvent que ce que le marché a réellement fait sur cette
  période (couverture actuelle : 21 %).
- Ce biais est **antérieur ET postérieur** à `corr-20260914-confidence-formule-reproductible`
  (44/56 = 78,6 % avant, 12/15 = 80 % après) : la formule de confiance a résolu la concentration
  sur 50/60 %, un vrai problème, mais n'a jamais touché ce mécanisme-ci — deux trous distincts.

**Règle, à partir de cette révision** — un seul levier, directement branché sur
`signal_consensus.technique` qui existe déjà, sans introduire de nouvelle donnée ni de formule
numérique inventée :

- `technique = "haussier"` et `accord_count ≥ 1` → le verdict **doit** être `ACHAT` (jamais ATTENTE
  par prudence).
- `technique = "baissier"` et `accord_count ≥ 1` → le verdict **doit** être `VENTE` (jamais ATTENTE
  par prudence).
- `technique` ∈ {"mixte", "neutre", "insuffisant", "a_risque_retournement", "peu_fiable"} →
  ATTENTE, comme aujourd'hui (aucun changement ici, cette partie n'est pas le problème).
- `accord_count = 0` → ATTENTE reste forcé (règle existante ci-dessus, inchangée).

**Ne pas confondre avec la section 4** : le plafonnement d'`accord_count` à 1 en cas de
contradiction avec `favoris-context.json`/`portfolio-thesis.json` reste inchangé et s'applique
normalement AVANT cette règle — un `technique` haussier plafonné à `accord_count = 1` par la
section 4 donne toujours ACHAT (accord_count ≥ 1), pas ATTENTE : seul `accord_count = 0`
(contradiction totale entre les 3 dimensions) annule la direction.

**Pourquoi ce choix et pas un autre** : c'est la lecture technique déjà calculée et déjà écrite
(`signal_consensus.technique`) qui décide, jamais une nouvelle mesure inventée. Si cette règle se
révèle mauvaise (ACHAT/VENTE plus souvent faux qu'ATTENTE ne l'était), ce sera visible dans
`accuracy_strict_pct` du prochain lot résolu et devra être documenté honnêtement dans
`correction_log` — comme `corr-20260906-test-horizon-adaptatif` puis
`corr-20260913-biais-chasse-momentum` l'ont déjà fait pour l'horizon adaptatif. **Ne pas juger
cette règle avant qu'un lot d'au moins ~10 verdicts émis sous elle ait atteint son horizon** (7-14
jours) — même principe que `MIN_RESOLVED_FOR_SELF_ASSESSMENT` côté site (`js/engine.js`).

**Anomalie de données non corrigée, signalée pour mémoire** : `v-20260807-btc` et `v-20260807-eth`
ont un `signal_precoce.note` (déjà en place depuis leur émission) signalant que leur
`price_at_issue` (55 800 $ BTC, 1 649,89 $ ETH) divergeait de ~16-17 % d'une double vérification
indépendante faite au moment de l'émission — anomalie repérée par la routine elle-même mais jamais
corrigée depuis ; `outcome` a été calculé depuis ce prix probablement erroné quand même. Impact
mesuré : ≤2 points sur `accuracy_strict_pct` (2 verdicts sur 56), donc pas la cause du problème
principal ci-dessus, mais un vrai résidu non tranché : soit corriger `price_at_issue` sur ces 2
entrées avec `outcome` recalculé en conséquence (rupture ponctuelle et documentée du principe
append-only, justifiable par une donnée connue comme fausse), soit les exclure explicitement des
statistiques agrégées avec une note — jamais laisser les deux valeurs fausses continuer à peser
silencieusement sur le bilan sans le dire. Décision non prise dans cette révision (nécessite une
vraie source de prix historique pour confirmer avant de corriger quoi que ce soit, règle absolue
en tête de ce document) — à trancher par la routine ou une session future avec l'outil adéquat.

## 3. Horizon adaptatif — déjà en place, ne pas casser

`horizon_days` = 7 plutôt que 14 pour les actifs identifiés comme volatils lors de la correction
`corr-20260906-test-horizon-adaptatif` (voir `engine-history.json.correction_log`) — **cette
logique fonctionne et reste en place telle quelle**, cette révision ne la touche pas. Continuer à
consulter `correction_log` à chaque cycle avant d'émettre un nouveau verdict sur un actif
récemment corrigé.

## 4. Croiser avec les données déjà écrites ailleurs — nouveau dans cette révision

Avant de finaliser un verdict sur un ticker, lire (lecture seule, déjà commitées par d'autres
routines, aucun nouvel appel réseau requis) :
- `data/favoris-context.json[ticker].long_term_thesis` (bull/base/bear) et `.onchain_signal`
- `data/portfolio-thesis.json.positions[cgId]` (recommendation + conviction), si l'actif y figure

Si la lecture technique de ce cycle **contredit franchement** l'un de ces deux (ex. signal
technique haussier net mais thèse hebdo "Réduire" avec conviction ≥7, ou l'inverse) : le noter
explicitement dans `reasoning` ("Signal technique haussier mais thèse hebdo Réduire — contexte à
surveiller") et **ne pas dépasser `accord_count` = 1** pour ce verdict, même si `technique` seul
semblait net — un signal technique fort qui va à l'encontre d'une recherche fondamentale réelle
n'est pas un signal fort au sens de ce document. Un accord (technique et thèse alignés) ne change
rien au calcul de la section 2, mais renforce la légitimité du `reasoning`.

**Ne jamais** transformer ce croisement en une 2e opinion inventée — c'est une lecture de deux
données déjà réelles, jamais une extrapolation au-delà de ce qu'elles disent.

### `signal_consensus.macro`/`regime_at_issue` — dériver de `data/market-context.json`, pas du seul fear & greed

**Constat du 15/09/2026 : ce document n'a jamais dit comment déterminer `regime_at_issue`, et les
cycles récents (lus dans `routine_health.last_failure_reason`) le déduisaient uniquement de
l'indice fear & greed** — un baromètre de sentiment, alors que `data/market-context.json`
(écrit par `aguilaradar-marche-quotidien`, lecture seule, aucun nouvel appel réseau requis) contient
des données macro bien plus rigoureuses, déjà collectées et déjà affichées sur le site (Moteur →
Contexte marché) mais jamais lues par cette routine : `fed_policy` (taux directeur, `stance`
hawkish/dovish/neutral, rendement du Trésor 10 ans, date de la prochaine réunion FOMC),
`etf_flows` (flux nets ETF spot BTC/ETH, avec détail par émetteur), `stablecoins` (capitalisation
totale, dominance), `gold` (prix spot, ratio BTC/or). Ignorer ce fichier revient à juger la
"macro" avec le signal le plus faible disponible alors que le plus solide existe déjà à côté.

**À chaque cycle, avant de fixer `signal_consensus.macro` et `regime_at_issue` sur CHAQUE verdict
du cycle (le contexte macro est le même pour tous, pas la peine de le relire par ticker)** :

1. Lire `data/market-context.json` en entier (`fed_policy`, `etf_flows`, `stablecoins` au minimum).
2. Combiner qualitativement, jamais avec une formule numérique inventée (même principe que
   `signal_consensus` en général — un désaccord entre signaux est montré, jamais masqué par un
   score composite) :
   - `fed_policy.stance` "hawkish" + rendement 10 ans en hausse marquée → pression vers `risk-off`
     (coût du capital plus élevé, moins favorable aux actifs à risque).
   - `etf_flows` nets positifs et croissants sur BTC/ETH → pression vers `risk-on` (demande
     institutionnelle réelle, indépendante du sentiment retail).
   - `stablecoins.dominance_pct` en hausse (la part du marché total en stablecoins augmente) →
     signal `risk-off` (capital qui se met en attente plutôt que déployé) ; en baisse → `risk-on`.
   - Fear & greed reste un signal parmi d'autres, jamais le seul — le combiner avec les 3
     ci-dessus, pas le remplacer par eux ni l'ignorer.
3. **Ces signaux ne s'alignent pas toujours — un cas réel rencontré le 15/09 : Fed hawkish + 10 ans
   ayant brièvement dépassé 5 % (plus haut depuis 2023) pointent `risk-off`, alors que les flux ETF
   BTC/ETH sont nets positifs sur plusieurs séances, ce qui pointe `risk-on`.** Dans ce genre de cas,
   retenir `neutre` plutôt que de forcer une lecture, et **le dire explicitement** dans le
   `reasoning` du verdict concerné (ex. "Régime macro neutre : Fed toujours restrictive et
   rendement 10 ans au plus haut depuis 2023, mais flux ETF BTC/ETH nets positifs — signaux macro
   contradictoires, retenus comme tels plutôt que tranchés arbitrairement") — jamais résoudre la
   contradiction en choisissant le signal qui arrange le verdict déjà envisagé.
4. Un événement macro imminent et connu (ex. `fed_policy.next_fomc_date` dans les 24-48h) mérite
   une mention explicite dans `reasoning` même sans trancher le régime — un verdict émis juste
   avant une décision Fed importante porte un risque différent d'un verdict émis juste après,
   information utile même si elle ne change pas `signal_consensus.macro` en soi.

## 5. Résolution des verdicts en attente

À chaque cycle, pour tout verdict `status:"pending"` dont `resolves_at` est dépassé : calculer
`actual_move_pct` depuis `price_at_issue` et le prix réel actuel, remplir `outcome` en entier
(`price_at_resolution`, `actual_move_pct`, `actual_direction`, `verdict_correct`,
`resolved_at`) — jamais un remplissage partiel (voir `test/data-fixtures.test.js`, qui rejette
déjà un verdict résolu avec un `outcome` incomplet).

## 6. `correction_log` — mémoire d'un cycle à l'autre, pas un ajout systématique

**N'ajouter une entrée que lors d'un vrai changement de procédure/paramètre tenté**, jamais à
chaque cycle. Réutiliser exactement la forme déjà en place (`id, logged_at, trigger, what, why,
validation_score_before_pct, validation_score_after_pct, action, status`). Quand un lot de
verdicts affectés par une correction précédente se résout, **revenir sur l'entrée correspondante**
et renseigner son `validation_score_after_pct` plutôt que de créer une entrée séparée — c'est ce
qui a déjà été fait pour `corr-20260906` (fermé par `corr-20260913`), continuer sur ce modèle.

Vu l'exactitude actuelle sous la baseline (section "État réel des performances" ci-dessus), une
fois un lot de verdicts émis sous cette révision (croisement + confidence_pct reproductible)
résolu en nombre suffisant, logger honnêtement si l'exactitude s'est améliorée, dégradée, ou n'a
pas bougé de façon significative — jamais présenter une amélioration qui ne serait pas
statistiquement confirmée par les chiffres réels.

## 7. `engine-history.json.routine_health` — à jour à CHAQUE cycle, même sans verdict émis

**Constat du 15/09/2026** : le bandeau de fraîcheur du site (`updateFreshnessIndicator`, `app.js`)
lit `routine_health.last_success_at` et affiche "la routine semble bloquée" si ce champ dépasse
12h. Ce champ était resté figé à 16h20 UTC le 14/09 alors que des cycles réels et corrects avaient
tourné après (dont celui de 20h22 UTC qui a résolu `v-20260907-ctsi` et émis `v-20260914-ctsi`,
fusionné vers `main` correctement) — le site affichait donc une fausse alerte pendant qu'il
fonctionnait normalement. Cause : ce champ n'a jamais été formellement spécifié ici, donc mis à
jour de façon incohérente d'un cycle à l'autre plutôt qu'à chaque fois.

**Mettre à jour `routine_health.last_success_at` (et remettre `consecutive_failures` à 0) à la fin
de CHAQUE cycle qui s'exécute sans erreur — y compris un cycle qui ne fait "rien" parce qu'aucun
verdict n'est dû et aucune résolution n'est en retard.** `last_failure_reason` peut continuer à
porter un résumé texte du cycle (utile pour le debug) même quand il n'y a pas eu d'échec — mais ne
jamais laisser `last_success_at` immobile simplement parce que rien de nouveau n'a été émis. C'est
la seule façon pour l'indicateur de fraîcheur de distinguer "routine vivante, rien à signaler ce
cycle" de "routine réellement bloquée" — les deux ont l'air identiques de l'extérieur si ce champ
n'avance pas.

## 8. `data/news.json` — veille actualités, jamais documentée avant cette révision

**Constat du 15/09/2026** : cette routine fait réellement une veille actualités à chaque cycle
(recherche fear&greed, dominance BTC, recherche générique "crypto news today", recherche dédiée
hack/exploit — confirmé en lisant `routine_health.last_failure_reason` de plusieurs cycles
récents) et écrit dans `data/news.json`, mais **cette responsabilité n'avait jamais été spécifiée
dans ce document** — un vrai trou, pas juste un oubli cosmétique : le contenu réel (8 items
sourcés et datés fin août-mi septembre 2026, ex. scission Consensys, projet de loi fiscal allemand,
vote CLARITY Act) est correct, mais **`last_checked_at` était figé à 2026-09-14T16:20:00Z alors
que le cycle a tourné avec succès plusieurs fois depuis** (même cause que `routine_health` ci-dessus
— confirmé le 15/09 par la routine `aguilaradar-verif-fraicheur-quotidien` elle-même :
`data/news.json` à ~34h de retard, en aggravation). Le bandeau de fraîcheur du site
(`updateFreshnessIndicator`, `app.js`) lit `last_checked_at` en priorité, donc ce champ figé fait
croire à une veille interrompue même quand elle tourne normalement.

### Forme exacte

```json
{
  "last_checked_at": "<ISO 8601 UTC — À CHAQUE cycle, que quelque chose de nouveau soit trouvé ou non>",
  "last_updated_at": "<ISO 8601 UTC — SEULEMENT quand `items` change réellement>",
  "items": [ { "title": "...", "url": "...", "source": "..." } ]
}
```

**Ces deux champs ont un sens différent, ne jamais les confondre** : `last_checked_at` prouve que
la veille a eu lieu ce cycle (même si rien de neuf n'a été retenu) ; `last_updated_at` marque la
dernière fois où `items` a réellement changé. Un `last_checked_at` récent avec un `last_updated_at`
plus ancien est un état normal et attendu (pas d'actualité neuve jugée assez significative
récemment) — **mais `last_checked_at` lui-même ne doit jamais rester figé plus d'un cycle**.

### Procédure, une fois par exécution

1. Faire la recherche (fear&greed, dominance, actualité générale, hack/exploit dédié — déjà la
   pratique réelle, formalisée ici) : chercher un développement réellement nouveau et significatif
   (lancement produit majeur, hack, régulation, mouvement institutionnel) — jamais une reformulation
   d'un item déjà présent dans `items`.
2. Si un développement neuf et suffisamment significatif est trouvé : l'ajouter à `items` (`title`
   factuel et sourcé, `url` réelle, `source`) et mettre à jour `last_updated_at`.
3. **Que l'étape 2 ait ajouté quelque chose ou non, toujours mettre à jour `last_checked_at`** à
   l'heure de fin de ce cycle — c'est la partie manquée jusqu'ici, celle qui casse le bandeau de
   fraîcheur si elle est sautée.
4. `items` n'est pas strictement append-only comme `verdicts.json`/`onchain-history.json` : retirer
   les entrées les plus anciennes/plus pertinentes si la liste devient longue (pas de taille cible
   fixée ici — garder un jugement raisonnable, quelques items réellement notables plutôt qu'un flux
   exhaustif).

## 9. Commit — deux étapes obligatoires, pas juste "push"

**Constat du 14/09/2026** : le premier cycle exécuté sous cette révision a produit un commit
correct (confidence_pct=65, croisement bien appliqué, `correction_log` correctement mis à jour)
mais **s'est arrêté après le commit sur sa propre branche de sortie, sans jamais atteindre
`main`** — resté invisible sur le site en ligne jusqu'à une fusion manuelle. Vérifié en comparant
avec un cycle antérieur réussi (`0101615`/`8a0e2b3`, 14/09 16h20 UTC) : la même session y avait
fait exactement 2 commits, 39 secondes d'écart, tous deux signés `Claude <noreply@anthropic.com>`
— un commit normal sur sa branche, PUIS un commit de fusion sur `main` dont les 2 parents sont
l'ancien HEAD de `main` et ce commit. **"Pousse-le sur main" ne suffit pas comme instruction** si
l'étape de fusion n'est pas explicitement nommée.

Procédure en 2 étapes, obligatoires toutes les deux à chaque cycle :
1. Commit normal (un seul, sur la branche de travail courante) couvrant les deux fichiers
   modifiés, message clair (ex. "Cycle du &lt;date&gt; : N verdicts émis, M résolus").
2. **Fusionner explicitement cette branche dans `main` et pousser `main`** — `git checkout main`
   (ou équivalent), `git merge --no-ff &lt;ta-branche&gt; -m "Merge cycle &lt;date&gt; into main"`,
   `git push origin main`. Ne pas considérer le cycle terminé tant que cette 2e étape n'a pas
   réussi — un commit qui reste seulement sur une branche de sortie, jamais fusionné, équivaut à
   ne rien avoir écrit du point de vue du site en ligne.
