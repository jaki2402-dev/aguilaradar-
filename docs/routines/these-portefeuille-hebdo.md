# `aguilaradar-these-portefeuille-hebdo` — thèse fondamentale hebdo du portefeuille

Routine Cowork, lundi 05h01 UTC, **session fraîche** (`persist_session: false`). Seul fichier
écrit : `data/portfolio-thesis.json` (régénération complète, écrase l'ancien contenu).

## Rôle

Pour chaque position **non `pending`** de `data/portfolio.json` : vraie recherche web (≥ 2 sources
indépendantes, concurrents/catalyseurs/risques/unlocks/actu 7 j), rédige un constat honnête
(2-3 phrases, jamais générique) + une recommandation (`Renforcer`/`Conserver`/`Attendre`/`Réduire`)
+ une conviction `/10`.

## Schéma exact

```json
{ "generated_at": "<ISO8601 UTC>", "positions": { "<cgId>": { "recommendation": "...", "conviction": 1-10, "constat": "..." } } }
```

Clé = **`cgId`**, jamais le ticker (table fixe des 15 favoris → `cgId` dans le prompt stocké).
Aucune entrée pour une position `pending`.

## Commit — piège connu, lu dans le prompt stocké

`main` est une branche protégée : un `git push` normal depuis la branche de travail n'atteint
**jamais** `main` seul (leçon du 17/08 sur une autre routine : 3 cycles poussés sur leur branche,
aucun fusionné, site resté bloqué des heures sans que personne ne s'en rende compte). La routine
doit fusionner elle-même (`checkout -b temp-merge-these origin/main && merge <branche> --no-ff &&
push temp-merge-these:main`, jamais `--force`). Si la fusion échoue après plusieurs essais : au
minimum la branche de travail doit être poussée, et le dire explicitement dans son résumé final —
cette routine ne repasse que dans 7 jours, aucun rattrapage automatique.

Consommée en lecture par `briefing-crypto-hebdo-cloud` (si `generated_at` < 10 jours, sinon constat
de secours rédigé par cette dernière) et par `js/allocation.js` (verdict + thèse hebdo seulement).

## Fiabilité

N'utilise jamais un outil `mcp__CoinGecko`/`mcp__Alpha`/`mcp__Anthropic_Economic_Index`/`mcp__econ`
même listé disponible — bloquerait la session indéfiniment en exécution automatisée.
