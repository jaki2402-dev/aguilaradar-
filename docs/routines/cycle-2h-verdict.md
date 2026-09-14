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

## 7. Commit

Un seul commit git par cycle couvrant les deux fichiers modifiés, message clair (ex. "Cycle du
<date> : N verdicts émis, M résolus"), même convention que le reste de ce projet.
