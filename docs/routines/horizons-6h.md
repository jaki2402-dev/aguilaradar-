# `aguilaradar-horizons-6h` — résolution des horizons d'opportunités, quotidien

Routine Cowork, 06h35 UTC, **session fraîche** (`persist_session: false`). Seul fichier touché :
les objets `horizons` (`j1/j3/j7/j14/m6`) de `data/opportunities.json` (jamais les champs
d'affichage ni la liste elle-même).

**P15 de `docs/feuille-de-route.md` — devenue inutile depuis le 11/10/2026** : le robot GitHub
`resolve-due` (`scripts/resolve-due.mjs`, zéro quota) résout désormais ces mêmes horizons comme
étape de `price-alerts`/`technical-daily`. Une session ne peut pas la désactiver elle-même (le
système refuse) — **à faire par l'utilisateur** :
`claude.ai/code/routines/trig_012L3zXByo7gQXCfAYQsrWhn`. Sans urgence : elle ne trouve
généralement plus d'horizon dû à traiter (`resolve-due` passe avant elle), donc la plupart de ses
cycles ne commitent rien — pas un échec, juste un no-op.

## Rôle (tel que conçu à l'origine)

Pour chaque horizon `status="pending"` ET `check_at <= maintenant` (opportunités actives **et**
archivées) : prix réel à la date exacte de `check_at` (API CoinGecko HTTP directe
`/coins/{cgId}/history?date=DD-MM-YYYY`, jamais l'outil MCP `get-coin-history` — bloquerait la
session), calcule `move_pct = (prix_à_check_at - price_at_flag) / price_at_flag * 100`,
`validated = move_pct >= threshold_pct`. Écrit par script Python (jamais une réécriture à la
main), commit immédiat dès l'écriture.

## Règles dures

Un horizon en retard garde le prix **réel à sa date `check_at`**, jamais le prix du jour ; jamais
un chiffre inventé (reste `pending` plutôt qu'une estimation) ; un horizon déjà `resolved` n'est
jamais réécrit (historique permanent).
