# `aguilaradar-verif-fraicheur-quotidien` — vérification de fraîcheur, quotidienne

Routine Cowork (09:15 UTC), session persistante. Lecture seule ; n'écrit qu'une entrée dans
`data/health-log.json`. **Ce fichier remplace les étapes 2 et 3 du prompt stocké** (version du
17/08, jamais réécrite) partout où ils se contredisent.

## Étapes 2 et 3 : une seule commande, depuis la racine du dépôt

```bash
python3 scripts/verif-fraicheur.py
```

Pour chaque source : horodatage, âge (`XhYY`), seuil, puis `OK` ou `ATTENTION`. Reprendre ces âges
tels quels dans la note de l'étape 4 ou 5 ; `ABSENT` ou `ILLISIBLE` se signalent tels quels, sans
rien deviner (un fichier illisible n'empêche pas de vérifier les deux autres). Ne lire
aucun de ces fichiers en entier (`Read`/`cat`) : `opportunities.json` pèse ~125 Ko pour 3 dates utiles.

| Source | Champ qui fait foi | Seuil |
|---|---|---|
| Cycle profond | `engine-history.json` → `routine_health.last_success_at` | 8 h |
| Actualités | `news.json` → `last_checked_at` | 1,5 × `REFRESH.deepCycleHours` (`js/config.js`), actuellement 12 h |
| Opportunités | `opportunities.json` → `last_scan_at` | 36 h |

Champs à ne **jamais** utiliser, anciens par nature :
- `news.json` → `last_updated_at` : ne bouge que si une actualité nouvelle passe le filtre du cycle
  profond ; plusieurs jours sans changement est normal. Cause des fausses alertes du 15/09 et du 06/10.
- `opportunities.json` → `last_checked_at` : champ mort, figé au 14/09/2026.

Ne pas appeler `list_triggers`, même si le correctif collé le 06/10 le mentionne : ~110 000
caractères qui resteraient dans le contexte de cette session persistante, alors que la cadence se
lit dans `js/config.js` (ce que fait le script).

## Historique

- 15/09 et 06/10 : fausses alertes `news.json`, jugé sur `last_updated_at`.
- 05/10 : prompt corrigé préparé « à coller » (extraction python, `last_checked_at`) mais **jamais
  collé** — constaté le 06/10 via `list_triggers`/`get_trigger` : prompt stocké encore en version 17/08.
- 06/10 au soir : correctif collé en fin de prompt, renvoyant ici ; les étapes 2-3 d'origine
  (`news.last_updated_at > 8h`, lecture « Read ou cat ») n'ont pas été réécrites, d'où la règle de
  priorité en tête de ce fichier.
