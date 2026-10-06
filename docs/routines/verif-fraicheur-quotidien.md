# `aguilaradar-verif-fraicheur-quotidien` — vérification de fraîcheur, quotidienne

Routine Cowork (09:15 UTC), session persistante. Vérifie que les cycles automatisés tournent
réellement et committe une alerte `ATTENTION FRAICHEUR` sur `main` quand ce n'est pas le cas.
Lecture seule sur toutes les données qu'elle inspecte — aucun outil de correction, seulement un
signal pour qu'un humain (ou une autre routine/session) intervienne.

## Bug corrigé ici (06/10/2026)

Un correctif du 05/10/2026 avait déjà identifié que cette routine jugeait `data/news.json` sur
`last_updated_at` au lieu de `last_checked_at`, produisant une fausse alerte quasi quotidienne
(`last_updated_at` reste normalement figé plusieurs jours — c'est attendu, voir
`cycle-2h-verdict.md` §8 — tant qu'aucune actualité réellement nouvelle ne passe le seuil de
sélectivité du cycle profond). Le correctif a été appliqué au prompt de cette session persistante
mais ne s'est pas reflété dans le comportement observé le lendemain : l'alerte du 06/10 09h16 UTC
(`ATTENTION FRAICHEUR : news.json figé depuis ~24h36`) a été vérifiée a posteriori contre
`data/news.json` et `data/engine-history.json.routine_health` à l'horodatage exact du commit —
`last_checked_at` était alors vieux de 21 minutes (parfaitement frais), seul `last_updated_at`
correspondait aux ~24h36 annoncées. Fausse alerte confirmée, pas une supposition.

Cause probable : un correctif de prompt ajouté à une session déjà longue (plusieurs semaines
d'historique de conversation) ne garantit pas que l'instruction soit suivie de façon fiable à
chaque nouvelle exécution — contrairement à une session fraîche qui lit son prompt complet à
chaque fois. D'où ce fichier : la règle vit maintenant dans un spec versionné, relu en entier à
chaque passage (même pattern déjà adopté pour `aguilaradar-cycle-2h`, voir `cycle-2h-verdict.md`),
plutôt que dans une correction ponctuelle ajoutée en cours de conversation.

## Règle, pour CHAQUE source vérifiée

Deux familles de champs, jamais confondues :

- **"la vérification a eu lieu"** (ex. `news.json.last_checked_at`,
  `engine-history.json.routine_health.last_success_at`) — un champ figé est TOUJOURS un vrai
  problème, à signaler.
- **"la dernière fois qu'un changement réel est survenu"** (ex. `news.json.last_updated_at`,
  la date du dernier item réellement ajouté à une liste) — un champ ancien est NORMAL et ATTENDU
  tant que rien de nouveau ne mérite d'être ajouté. Ne JAMAIS l'utiliser seul pour juger une
  fraîcheur — seulement le champ "vérification a eu lieu" correspondant en fait foi.

Calculer l'écart par extraction `python3` directe sur le JSON (comparer un champ nommé à l'heure
réelle via `datetime`), jamais en lisant/estimant le texte à l'œil — même discipline que
`cycle-2h-verdict.md` §8 pour la même raison (fiabilité, pas de supposition sur une date).

### `data/news.json`

Champ qui prouve la vérification : **`last_checked_at`** (pas `last_updated_at` — piège déjà
documenté deux fois, 15/09 et 06/10, voir ci-dessus). Seuil d'alerte : au-delà de l'intervalle du
cycle profond (`aguilaradar-cycle-2h`, actuellement 8h — vérifier via `list_triggers` plutôt que
de supposer, le cadencement a déjà changé plusieurs fois) + une marge raisonnable pour un cycle
manqué (ex. 1,5× l'intervalle), jamais un seuil fixe codé en dur qui redeviendrait faux au
prochain changement de cadencement.

### `engine-history.json.routine_health.last_success_at`

Champ qui prouve la vérification : lui-même — déjà la bonne pratique en place (voir
`cycle-2h-verdict.md` §7, mis à jour à chaque cycle sans erreur). Aucun changement nécessaire ici,
mentionné pour mémoire.

### Autres sources déjà suivies par cette routine (opportunités, etc.)

Non ré-auditées dans ce correctif — seul le cas news.json a été vérifié avec des horodatages
exacts. Si une autre source suit le même motif à deux champs (vérification vs dernier changement
réel), appliquer la même règle plutôt que d'attendre une fausse alerte supplémentaire pour la
remarquer.
