# `aguilaradar-groupe-temoin-hebdo` — échantillonnage du groupe témoin, hebdo

Routine Cowork, dimanche 09h08-09h14 UTC, **session fraîche** (`persist_session: false`). Seul
fichier touché : `data/control-group.json` (lecture seule sur `verdicts.json`/`opportunities.json`
pour les exclusions).

## Rôle

Comble un trou historique : `control-group.json` existait depuis longtemps mais n'était jamais
peuplé (`sample_size=0`), seule la résolution était gérée ailleurs. Alimente la section « Criblage
vs sélection au hasard » du site : un échantillon **purement aléatoire** du Top 300 (hors favoris,
hors `opportunities.json`, hors tickers déjà échantillonnés) pour comparer le taux de réussite du
criblage à une sélection sans jugement.

## Méthode (si moins de 8 items `pending`)

Divise le Top 300 en bandes de rang (ex. 1-50, 51-100, …), choisit une position par bande
**uniquement sur le rang**, jamais sur un jugement de qualité du projet — sauter et remplacer
immédiatement un memecoin ou un actif déjà exclu. `cgId` toujours vérifié via `/api/v3/search`
avant usage, jamais deviné. Schéma d'un item :
`id="cg-YYYYMMDD-TICKER", ticker, cgId, sampled_at, price_at_issue, resolves_at (+14j), status:
"pending", outcome:{price_at_resolution, move_pct, validated, resolved_at}` tous `null` au départ.
Si déjà ≥ 8 `pending` : ne fait rien, ne commit rien.

**Ne calcule jamais `stats.validated_pct`** (rôle exclusif de `aguilaradar-cycle-2h` à la
résolution) — le crée vide si structurellement absent, sans jamais deviner une valeur.

## Règles dures

Jamais de memecoin, même via une bande de rang qui n'en contiendrait « que » quelques-uns —
sauté systématiquement ; jamais un `cgId` deviné ; jamais un prix inventé (position suivante de la
bande essayée à la place) ; aucune sélection basée sur un jugement de qualité.
