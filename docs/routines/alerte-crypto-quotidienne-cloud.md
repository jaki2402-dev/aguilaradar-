# `alerte-crypto-quotidienne-cloud` — alerte portefeuille, 2×/jour

Routine Cowork, 06h45 et 18h45 UTC, **session fraîche**. **`created_via: http_api`** — pas créée
par un agent, donc **modifiable uniquement par l'utilisateur lui-même** dans Cowork (voir
CLAUDE.md « Routines Cowork — pièges » : relire le prompt complet via `get_trigger` avant toute
proposition de changement, un ajout en fin de prompt ne neutralise pas une étape contradictoire).
Lecture seule sur le dépôt — le livrable est un email Gmail (`mcp__Gmail__send_message`, jamais
`create_draft`).

## Rôle — un check binaire, pas une régénération de contenu

Le silence (ne rien envoyer) est le résultat normal de la majorité des passages. Une seule requête
HTTP publique (`WebFetch`) vers `data/portfolio.json` brut (jamais de dépôt cloné) pour `qty`/
`invested` à jour — toujours relus à chaque passage, jamais une valeur mémorisée d'un envoi
précédent. Une position `pending:true` ou `qty`/`invested` à `null` est ignorée pour les checks
(a)/(b) ci-dessous.

Trois checks objectifs, chacun vérifié par ≥ 2 sources (`WebSearch`) :
**(a)** mouvement de prix > 15 % sur 24h sur une position non-`pending` ;
**(b)** seuil de vigilance qualitatif par ticker franchi (liste fixe dans le prompt, datée du
28/07/2026, à traiter comme point de départ et non comme vérité figée) ;
**(c)** actu macro/crypto vraiment majeure des dernières 24h (critère explicite : ne jamais juger
« pas majeure » seulement parce que conforme au consensus — chercher un vote scindé, un
qualificatif d'exception, un changement de ton, un retournement de flux ETF).

Si et seulement si un déclencheur est confirmé : email avec sujet
`"Alerte crypto — [date] — [résumé court]"`.

## Identité visuelle partagée (3 emails du projet)

Même gabarit que `briefing-email-quotidien` et `briefing-crypto-hebdo-cloud` : fond clair
`#F0EFEA`, carte blanche `#FFFFFF` max 600px (`width="100%" style="max-width:600px"`, jamais un
`width` fixe seul — casse sur mobile étroit), bandeau `#181C24` + carré or `#C89B3C`, vert
`#0E9F6E`/rouge `#DC2626` pour gain/perte, tables HTML imbriquées uniquement (jamais flexbox/grid),
même disclaimer réglementaire en pied de page.

## Fiabilité

N'utilise jamais `mcp__CoinGecko`/`mcp__Alpha`/`mcp__Anthropic_Economic_Index`/`mcp__econ` même
listés disponibles — cause confirmée du silence de plusieurs routines entre le 12/08 et le 24/08.
`mcp__Gmail__...` reste nécessaire et autorisé.
