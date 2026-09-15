# Routine Cowork : `aguilaradar-marche-quotidien`

Cadence : quotidienne (08:40 UTC). MCP accordés : CoinGecko, Alpha Vantage, Anthropic Economic
Index, Blockscout, Cloudflare Developer Platform — **mais voir la règle fiabilité ci-dessous avant
d'en utiliser un seul.** Dépôt : `jaki2402-dev/aguilaradar-`, écrit et commite uniquement dans
`data/market-context.json`.

Spécification de référence versionnée (même principe que `docs/routines/favoris-quotidien.md` et
`docs/routines/cycle-2h-verdict.md`) — modifier CE fichier + committer avant toute nouvelle
révision du prompt de cette routine, jamais un `update_trigger` à l'aveugle sans passer par ici
d'abord. **Écrite le 15/09/2026 en versionnant fidèlement le prompt réel de la routine** (jamais
documenté avant, la seule des 3 routines quotidiennes/2h dans ce cas) — cette routine fonctionne
déjà bien (flux ETF avec réconciliation multi-sources réelle, ratio BTC/or cohérent temporellement,
`fed_policy` bien sourcé) : ce document formalise ce qui marche pour éviter qu'il se perde ou
dérive à une future révision, ce n'est pas une réparation de quelque chose de cassé.

## Règle fiabilité — permanente, ne jamais retirer, la plus importante de ce document

**N'utilise JAMAIS un outil dont le nom commence par `mcp__CoinGecko`, `mcp__Alpha` (Alpha
Vantage) ou `mcp__Anthropic_Economic_Index`/`mcp__econ`, même s'il apparaît disponible pour cette
session.** Un appel à l'un de ces outils **bloque la session indéfiniment en exécution automatisée,
sans jamais committer** — cause confirmée à plusieurs reprises sur cette routine. Pour toute donnée
prix/marché : **WebFetch en appel direct** (`api.coingecko.com`, `api.binance.com` autorisés), avec
**WebSearch en repli** si l'appel direct échoue.

**Seule exception du projet : `aguilaradar-opportunites-quotidien`**, qui tourne en session
persistante (pas ce mode d'exécution automatisée one-shot) et dont le connecteur CoinGecko est
réellement autorisé — ne pas généraliser cette exception à cette routine-ci ni à une autre sans
avoir vérifié le mode d'exécution.

**Si une future révision de ce document propose d'utiliser un outil Alpha Vantage** (par exemple
pour le rendement du Trésor à 10 ans, `fed_policy.treasury_yield_10y_pct`) **parce qu'il a été
vérifié fonctionner dans une session interactive de développement : ce n'est pas une preuve
suffisante.** Une session interactive et une exécution automatisée ne se comportent pas pareil sur
ces outils précis — c'est exactement l'erreur qui a causé le blocage confirmé plusieurs fois. Rester
sur WebFetch/WebSearch pour ces champs tant que le mode d'exécution automatisée n'a pas lui-même
été testé avec succès plusieurs cycles de suite.

## Règle absolue (s'applique à tout ce document, comme les 2 autres routines)

**Ne jamais inventer un chiffre.** Un champ non confirmé par une vraie source ce cycle reste `null`
avec une `note` expliquant pourquoi — jamais une valeur devinée, recopiée d'un cycle précédent en
la faisant passer pour fraîche, ou mélangée entre deux instants différents (ex. un ratio BTC/or
calculé à partir de deux prix relevés à des moments différents).

## Périmètre — UNIQUEMENT `data/market-context.json`

Ne touche à aucun autre fichier `data/*.json` (`favoris-context.json` appartient à
`aguilaradar-favoris-quotidien`, `health-log.json` à `aguilaradar-sante-quotidien` — historique :
les 3 partageaient un seul passage jusqu'au 10/08, isolées depuis pour garantir l'exécution de
chacune indépendamment des 2 autres). Lecture seule autorisée sur `engine-history.json` pour
`site_confidence` (voir plus bas). Ne modifie jamais `index.html`/`css/`/`js/`/`manifest.json`/
`favicon.svg`.

## Forme exacte de `data/market-context.json` et sourcing par bloc

```json
{
  "last_computed_at": "<ISO 8601 UTC>",
  "stablecoins": { "total_market_cap_usd": <number|null>, "dominance_pct": <number|null>, "supply_trend_7d_pct": <number|null>, "note": "...", "source": "..." },
  "employment_us": { "last_report_date": "YYYY-MM-DD", "unemployment_rate_pct": <number|null>, "nonfarm_payrolls_change_k": <number|null>, "market_reaction_note": "...", "source": "..." },
  "etf_flows": { "period": "...", "btc_etf_net_flow_usd": <number|null>, "eth_etf_net_flow_usd": <number|null>, "note": "...", "source": "..." },
  "gold": { "spot_usd_per_oz": <number|null>, "btc_to_gold_oz_ratio": <number|null omis si non calculable>, "note": "...", "source": "..." },
  "fed_policy": { "funds_rate_range": "...", "stance": "hawkish|dovish|neutre", "balance_sheet_trend": "expansion|reduction|stable", "next_fomc_date": "YYYY-MM-DD (omis si non trouvée)", "treasury_yield_10y_pct": <number|null>, "note": "..." },
  "site_confidence": { "last_computed_at": "<ISO 8601 UTC>", "level": "élevé|moyen|faible", "note": "..." }
}
```

- **`stablecoins`** : dominance via `get-categories`/`coins/markets?category=stablecoins`
  (capitalisation stablecoins ÷ capitalisation totale globale), WebSearch en repli.
  `supply_trend_7d_pct` **reste `null` si aucune source fiable** — limite connue et actuellement
  non résolue : l'endpoint `/coins/categories` de CoinGecko n'expose qu'une variation 24h liée au
  prix, pas une tendance d'offre datée sur 7 jours. Ne pas deviner un proxy en attendant qu'une
  vraie source soit trouvée.
- **`employment_us`** : WebSearch, source réelle citée (URL). **Ne mettre à jour que si un nouveau
  rapport est sorti** depuis le dernier passage (BLS publie mensuellement, généralement le premier
  vendredi du mois) — sinon laisser le bloc inchangé, ce n'est pas un oubli.
- **`etf_flows`** : `https://farside.co.uk/btc/` (et `/eth/`) en WebFetch direct d'abord, WebSearch
  en repli si inaccessible (le proxy sortant de l'environnement de cette routine bloque déjà ce
  domaine par le passé — pas une erreur du site lui-même). **En cas de désaccord entre sources
  trouvées via WebSearch, vérifier activement plutôt que de reconduire un chiffre déjà écrit au
  cycle précédent** — un vrai cas s'est produit le 15/09 (un chiffre BTC du 11/09 était inversé,
  entrée nette présentée comme sortie nette ; corrigé après recoupement de 4 sources concordantes).
  Si rien de fiable : `null` + note honnête, jamais un chiffre "probable".
- **`gold`** : `spot_usd_per_oz` via WebSearch, source réelle citée. `btc_to_gold_oz_ratio`
  **uniquement si le prix BTC du jour (déjà récupéré pour `stablecoins` ci-dessus) et le prix de
  l'or viennent du même cycle** — sinon omettre ce sous-champ plutôt que mélanger deux instants.
- **`fed_policy`** : WebSearch pour chaque sous-champ (taux directeur, prochaine réunion FOMC, tendance du bilan). `stance` (hawkish/dovish/neutre) et `balance_sheet_trend` (expansion/reduction/stable) doivent se fonder sur une déclaration ou un chiffre réel et récent, **jamais une supposition** — même règle que `regime_at_issue` dans `cycle-2h-verdict.md` (ne jamais deviner un régime). Ne remplir que les sous-champs trouvés avec une confiance réelle ce cycle ; laisser `null` sinon.
- **`site_confidence`** : niveau qualitatif combinant (lecture seule) `engine-history.json`'s
  `routine_health.consecutive_failures`, `data_source_reliability`, et `global_stats.accuracy_strict_pct`
  si ≥10 verdicts résolus — expliqué en 1-2 phrases dans `site_confidence.note`.

## Utilisation en aval — pourquoi ce fichier compte

Affiché sur le site (Moteur → Contexte marché, `insights.js:renderMarketContext`) et injecté dans
l'Assistant IA (`assistant.js`). **Depuis le 15/09/2026, `docs/routines/cycle-2h-verdict.md` §4
croise aussi ce fichier pour déterminer `regime_at_issue`/`signal_consensus.macro` sur chaque
verdict** — la qualité et la fraîcheur de ce que cette routine écrit ici a donc un effet direct sur
la rigueur des verdicts émis par `aguilaradar-cycle-2h`, pas seulement sur ce qui s'affiche.

## Commit — deux étapes obligatoires, déjà en place, ne pas régresser

**Cette routine a déjà son propre historique de ce piège** (indépendant de celui documenté sur
`aguilaradar-cycle-2h`/`favoris-quotidien`) : le cycle du 18/08 08h42 UTC avait commité avec succès
sur sa propre branche de sortie mais n'avait jamais atteint `main`, resté invisible sur le site
jusqu'à un rattrapage manuel. Procédure en place depuis, à ne jamais retirer :

1. `git fetch origin main`.
2. Vérifier s'il existe d'autres branches `claude/*` déjà poussées mais jamais fusionnées dans
   `main` et touchant `data/market-context.json` (`git branch -r`, puis
   `git log origin/main..origin/<branche> --oneline -- data/market-context.json` pour chaque
   candidate récente). Fusionner d'abord celles-ci, dans l'ordre chronologique, avant son propre
   travail.
3. `git checkout -b <branche-locale-temporaire> origin/main`, puis `git merge <branche> --no-ff`
   dans l'ordre chronologique (sa propre branche en dernier).
4. En cas de conflit sur `data/market-context.json` : ne jamais prendre bêtement "ours" ou
   "theirs" — comparer ce que contient chaque côté, garder la donnée la plus récente champ par
   champ. Valider le JSON (`python3 -m json.tool`) avant de committer la fusion.
5. `git push origin <branche-locale-temporaire>:main`. Si le push échoue (`main` a bougé
   entre-temps) : refaire un fetch et recommencer, **ne jamais forcer le push**.
6. Si la fusion échoue de manière persistante ou trop incertaine ce cycle : au minimum s'assurer
   que sa propre branche est bien poussée et le documenter dans le message de commit — le cycle
   suivant (étape 2) rattrapera automatiquement.

Un cycle qui réussit mais n'atteint jamais `main` vaut aussi peu qu'un cycle qui échoue
complètement — le site ne sert que `main`.

## Règles dures (rappel)

Jamais de memecoin ; jamais un chiffre inventé (omettre plutôt que deviner, vaut pour tous les
blocs ci-dessus) ; analyse informative uniquement, jamais un conseil financier réglementé ;
historique permanent, jamais réécrit ; sources fiables uniquement (TradingView, CoinMarketCap,
CoinGecko en accès direct HTTP, etc. — jamais un site non identifiable). Le texte écrit dans
`data/market-context.json` doit toujours utiliser des accents français corrects — relire avant
d'écrire.
