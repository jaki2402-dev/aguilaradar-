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
