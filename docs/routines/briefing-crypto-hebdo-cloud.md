# `briefing-crypto-hebdo-cloud` — briefing hebdo complet du portefeuille

Routine Cowork, lundi 06h05 UTC, **session fraîche**. **`created_via: http_api`** — modifiable
uniquement par l'utilisateur lui-même dans Cowork (voir CLAUDE.md « Routines Cowork — pièges »).
**Aucun accès Bash/Write/Edit/git** (correctif du 26/08 dans le prompt stocké) : lecture seule,
le livrable est un email Gmail (`mcp__Gmail__send_message`, jamais `create_draft`). N'écrit
jamais `data/portfolio-thesis.json` — le lit seulement (voir `these-portefeuille-hebdo.md`, qui
l'écrit réellement).

## Rôle

1. `qty`/`invested` lus en direct depuis `data/portfolio.json` (raw GitHub, jamais recalculés) ;
   position `pending` → mentionnée « pas encore configurée », exclue du total/P&L. Échec de la
   requête → aucun chiffre de remplacement inventé, le mail part quand même avec la partie
   macro/opportunités et le dit clairement.
2. Recherche web 7 jours : Fed/taux, géopolitique majeure, banques centrales/liquidité (flux ETF),
   or/pétrole, vue d'ensemble crypto, unlocks à venir, niveaux techniques BTC, 3-4 angles « que peu
   de monde regarde ».
3. Constat/recommandation/conviction par position : lus depuis `data/portfolio-thesis.json`
   (raw GitHub). Si absent, position manquante, ou `generated_at` > 10 jours : rédige un constat de
   secours pour **cette position uniquement** (vraie recherche, jamais générique) — **ne réécrit
   jamais ce fichier**, uniquement lecteur.
4. 1-2 opportunités hors portefeuille (Top 200, hors memecoins), catalyseur daté + sources.
5. Email : sujet `"Portefeuille crypto — [date] (briefing hebdo)"`.

## Design — le plus riche des 3 emails du projet

Même identité visuelle que `briefing-email-quotidien`/`alerte-crypto-quotidienne-cloud` (bandeau
`#181C24` + carré or, carte 600px `max-width`, tables imbriquées), plus spécifique à celui-ci :
bandeau d'en-tête avec valeur totale + P&L, encadré « Constat honnête » (bordure or `#C89B3C` +
triangle d'alerte), **vrai donut SVG inline** (cercles concentriques `stroke-dasharray`, 4-6
segments + légende), tableau des positions avec flèches `▲`/`▼` vertes/rouges devant chaque P&L%,
badges colorés par recommandation (vert=Renforcer, rouge=Réduire, jaune=Attendre, violet=
Conserver), encadré foncé « investissement du jour » (icône 💡), pied de page avec lien site +
disclaimer réglementaire. `plaintextBody` simple en complément du HTML.

## Fiabilité

Mêmes interdictions `mcp__CoinGecko`/`mcp__Alpha`/`mcp__Anthropic_Economic_Index`/`mcp__econ` que
les 2 autres emails du projet — `mcp__Gmail__...` seul autorisé.
