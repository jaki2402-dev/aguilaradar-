# `aguilaradar-sante-quotidien` — contrôle de santé, quotidien

Routine Cowork, 08h50-08h51 UTC, **session fraîche** (`persist_session: false`). Seul fichier
écrit : `data/health-log.json` (append-only, une entrée par passage) ; lecture seule sur les
autres `data/*.json` et `index.html` pour la vérification.

## P6 de `docs/feuille-de-route.md` — ne couvre que 9 fichiers sur 15, confirmé le 23/10/2026

Le prompt stocké (`updated_at` 06/09/2026, jamais retouché depuis) vérifie nommément
**uniquement** : `verdicts.json, opportunities.json, engine-history.json, alerts.json, news.json,
control-group.json, market-context.json, favoris-context.json, health-log.json`. **Non couverts** :
`digest.json, market-gauges.json, onchain-history.json, portfolio.json, portfolio-history.json,
portfolio-thesis.json` — un de ces 6 pourrait se corrompre ou se vider sans que cette routine le
signale. Correctif : mettre à jour la liste du point (b) du prompt stocké (`update_trigger`,
action à confirmer avec l'utilisateur).

## Rôle

(a) `WebFetch` le site (code 200, contenu non vide). (b) Chaque fichier listé ci-dessus : JSON
valide, non vide/tronqué. (c) `index.html` référence bien tous les `js/*.js` attendus (lecture
seule, jamais modifié). (d) Compare le **volume** de `verdicts`/`alerts`/`opportunities`/`news`/
`favoris_context_populated` au passage précédent (`health-log.json.checks[-1].counts`) — détecte
un effacement accidentel même si le JSON reste syntaxiquement valide (un tableau vide `[]` est un
JSON valide ; ajouté après l'incident du 11/08 où un commit externe avait vidé 3 fichiers sans
qu'aucun contrôle JSON ne l'attrape).

Une chute suspecte (→ 0, ou > 50 % sans raison documentée) : consignée dans `files_broken` +
note précise dans `health-log.json`, **jamais corrigée automatiquement** — lecture seule par
conception, une session humaine ou Claude Code décide de la suite.

## Règles dures

Ne modifie jamais `index.html`/`css`/`js`/`manifest.json`/`favicon.svg` ni un autre `data/*.json`
que `health-log.json` (sauf réparation prudente d'un JSON syntaxiquement cassé, documentée — jamais
pour une simple anomalie de volume). `checks` append-only : jamais une entrée modifiée/supprimée.

## Piège git

Fusion manuelle vers `main` obligatoire en fin de cycle (même mécanisme que les autres routines du
projet) — en cas de conflit sur `health-log.json` (fréquent, append sur la même base), garder les
**deux** entrées triées par `checked_at`, jamais en perdre une.
