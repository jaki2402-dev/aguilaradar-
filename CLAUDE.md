# CLAUDE.md

Règles et pièges uniquement — chargé dans CHAQUE session (routines comprises), donc gardé court
volontairement. Le *pourquoi* détaillé et l'historique des incidents : `docs/journal-technique.md`
(ne le lire que si une règle ci-dessous ne suffit pas). **Ne pas regonfler ce fichier** : un
nouveau constat va dans `docs/journal-technique.md`, ici seulement la règle en 1-3 lignes.

## Économie de tokens — OBLIGATOIRE pour toute routine et toute session

Le quota hebdo a été épuisé en fin de semaine (aucun commit de routine du 28/09 au 03/10/2026).
Chaque token lu reste dans le contexte et est re-payé à chaque tour suivant. Donc :

1. **Ne jamais lire en entier un fichier append-only** (`verdicts.json` ~156 Ko, `alerts.json`
   ~155 Ko, `opportunities.json` ~124 Ko, `health-log.json` ~90 Ko, `favoris-context.json`
   ~75 Ko, `onchain-history.json`, `engine-history.json`). Extraire seulement le nécessaire avec
   `python3 -c`/`jq` (ex. verdicts `pending` dont `resolves_at` est passé, dernière entrée, un
   seul ticker, compteurs).
2. **Écrire par script, pas par réécriture** : ajouter/modifier les entrées via un petit script
   `python3` (load → modifier → dump `ensure_ascii=False, indent=2`), puis
   `python3 -m json.tool fichier >/dev/null` pour valider. Jamais réafficher le fichier.
3. **Sortie d'outil courte** : `| head`, `--stat`, `-q`, `git log --oneline -5`. Pas de `cat` d'un
   gros fichier, pas de `git diff` complet sur `data/`.
4. **Recherche web proportionnée** : 1 recherche ciblée par fait à confirmer, mode standard ;
   pas de recherche « au cas où ». Prix : un seul appel groupé pour les 15 favoris.
5. **Cycle sans travail dû = cycle court** : si rien n'est à émettre/résoudre, faire uniquement
   le minimum spécifié (timestamps de santé + veille courte) et terminer.
6. **Ne pas relire `docs/journal-technique.md`** dans une routine ; seule la spec de la routine
   (`docs/routines/*.md`) est nécessaire.

## Budget routines — garde-fous anti-régression (réduction du 03/10/2026)

Le quota hebdo s'épuisait en ~3 jours. Causes réelles : ~38 exécutions/jour (dont un watchdog
toutes les 2h qu'on croyait désactivé), et des prompts faisant `cat` de ~480 Ko de JSON. Règles :

- **Plafond ~15 exécutions/jour** (état au 03/10 : ~14). Toute nouvelle routine ou cadence plus
  rapide → calculer le total/jour et en retirer autant ailleurs. Pas de routine « juste au cas où ».
- **Aucun prompt de routine ne lit un gros JSON en entier** : extraction `python3` ciblée en
  lecture, script `python3` en écriture. Vérifier ce point à chaque nouveau prompt.
- **Pas de rattrapage en rafale** après un quota épuisé : max 3 verdicts émis et 3 favoris par
  cycle (sinon le redémarrage reconsomme tout le quota récupéré).
- **Cadence ↔ code** : les seuils de fraîcheur (`FRESHNESS_SOURCES`, `app.js`) dérivent de
  `REFRESH.deepCycleHours` — changer la cadence du cycle = changer cette constante, rien d'autre.
- **Ne jamais croire la doc sur l'état d'une routine** : `list_triggers` (extraction `python3`)
  fait foi. Le watchdog était noté « désactivé » depuis le 06/09 et tournait toujours.
- **Modifier une routine** : un agent peut changer un horaire, mais le classifieur refuse en
  général désactivation/prompt, et une routine créée hors agent (`created_via: http_api`, ex.
  `alerte-crypto-quotidienne-cloud`) n'est modifiable que par l'utilisateur. Dans ce cas : fichier
  prêt à coller (scratchpad) + lien `claude.ai/code/routines/<id>`, puis vérifier avec
  `get_trigger`. Ne jamais dire « appliqué » sans cette relecture.
- **Secrets** : certains prompts (digest : clé privée VAPID) contiennent des secrets → jamais dans
  le dépôt (public). Clé publique du prompt digest ≠ celle de `js/notify.js` (changée le 23/09) :
  push digest probablement en échec, non vérifié.
- Vérifier l'effet : `/usage` en milieu de semaine. Piste suivante seulement si besoin : fusionner
  `sante-quotidien` et `verif-fraicheur-quotidien`.

## Ce qu'est ce projet

Radar crypto statique : analyse de marché, verdicts horodatés, moteur de backtest auto-correcteur,
onglet Portefeuille (`data/portfolio.json`), thèse hebdo (`data/portfolio-thesis.json`, vraie
recherche web par routine), classement d'allocation (`js/allocation.js` : verdict + thèse hebdo
seulement, « donnée non disponible » sinon). Repo **public** : tous les `data/*.json` (montants
du portefeuille compris) sont exposés — choix délibéré.

- Hébergement : GitHub Pages, fichiers statiques, pas de build/serveur.
- Automatisation : routines Cowork écrivent `data/*.json` + commit. Le frontend ne fait
  qu'afficher — ne calcule jamais verdicts/opportunités.
- Base de données = ce dépôt git, en ajout seulement, jamais écrasée.
- Cadence : prix/graphes en direct côté client ; verdicts/criblage/backtest en cycle profond
  cible toutes les 8h (`REFRESH.deepCycleHours`, seuils de fraîcheur dérivés de lui). Réduction
  du 03/10/2026 pour le quota (~38 → ~14 exécutions/jour), vérifiée via `list_triggers` :
  watchdog désactivé, cycle-2h `15 */8 * * *`, alertes e-mail et digest 2×/jour, horizons
  1×/jour ; digest/horizons lisent par extraction `python3` (plus de `cat` des gros JSON). Un cycle bloqué
  ne se voit que via l'indicateur de fraîcheur. Toujours vérifier l'état réel via `list_triggers`
  (sortie volumineuse : l'extraire en `python3`, champs name/enabled/cron/last_run).

## Commandes

```
npm install && npm test                          # suite complète (Vitest + jsdom)
npx vitest run test/engine.test.js -t "name"      # un test
```

Pas de build/lint. CI : `npm ci && npm test` sur push `main` et PR.

## Architecture — pièges

- **Pas de modules** : `js/*.js` = `<script>` classiques, une seule portée globale ; l'ordre dans
  `index.html` compte. Les tests injectent de vrais `<script>` (`test/helpers/loadPage.js`,
  jamais `eval`), `loadScripts` doit suivre l'ordre d'`index.html`, `setGlobal`/`getGlobal` pour
  les `const`/`let` de haut niveau.
- **`js/config.js` = seule source de config** (`FAVORIS`, `SECTORS`, `REFRESH`, `THRESHOLDS`,
  `DATA_URLS`, `escapeHtml`/`safeUrl`). IDs CoinGecko **vérifiés via `/api/v3/search`, jamais
  devinés** (Flux = `zelcash`, pas `flux`). `THRESHOLDS.directionalMovePct` = LE seul seuil
  directionnel, partout.
- **Confiance** : news, texte IA, API CoinGecko = non fiables → `escapeHtml()` avant `innerHTML`,
  `safeUrl()` avant tout `href`. Texte d'analyse long → `highlightKeyInfo()` (échappe d'abord) ;
  label de scénario en `<span>`, jamais `<strong>` ; regex des nombres sépare espace des milliers
  et virgule décimale (test `config.test.js`). Assistant : seul `role === "assistant"` est
  surligné, le message utilisateur reste `textContent`.
- **`js/data-integrity.js`** : fonctions pures, **signale, ne corrige jamais**. Fraîcheur par
  favori (`last_computed_at`) complémentaire de `FRESHNESS_SOURCES` (`app.js`, par fichier).
- **`js/onchain.js`** : BTC seul a le niveau « direct » (fetch navigateur) ; 7 autres actifs à
  chaîne propre = historique seulement (`ONCHAIN_OWN_CHAIN_ASSETS`) ; 6 tokens sans chaîne propre
  = explication, jamais de graphe ; `fetch-ai` non classé tant que non vérifié. `< 2` points réels
  → « Historique insuffisant », jamais d'interpolation.
- **Un fetch au mode d'échec différent = son propre `try/catch`**, jamais dans un `Promise.all`
  partagé (une rejection fait tomber les autres). Idem `fetchFavorisSupply()` (une fois au
  chargement, pas au tick 60s).
- **Bouton/lien dans une carte cliquable** (`.favori-tile`, `.journal-entry`) →
  `e.stopPropagation()`, sinon la carte se replie.
- **`js/verdict-breakdown.js`** : 5 catégories, **jamais de score global** tant qu'une catégorie
  est « Donnée insuffisante ». Risque n'est jamais « Donnée insuffisante ». Pas de `max_supply`
  → « Offre non plafonnée ». Doit rester synchro avec `docs/verdict-methodology.md`.
- **Panneaux dépliables** : jamais de `max-height` fixe ; mesurer `scrollHeight` juste après le
  lancement du rendu async (même tick) et re-mesurer après la promesse, succès OU échec.
- **Grilles** : `min-width: 0` sur les items contenant un `<table>` ; vérifier à 390px
  (`document.body.scrollWidth`). Colonnes plus étroites ≠ page plus courte pour du texte long.
- **WCAG AA** vérifié par calcul (`--text-faint #7e8ba3`, badge cloche `#c22a22`) : vérifier le
  contraste de toute nouvelle couleur.
- **Portail d'accès** (`js/auth.js`, `ACCESS_HASH`) : filtre anti-curieux, pas de la sécurité.

## Relais IA (`cloudflare-worker/`)

Ordre assistant : données sourcées d'abord → relais IA → mots-clés (`CHAT_INTENTS`) seulement si
le relais échoue. **Déploiement** : Cloudflare surveille un AUTRE repo,
`jaki2402-dev/aguilaradar-assistant-ia` — copier `worker.js`/`wrangler.jsonc`/`package.json`/
`README.md` là-bas, pousser, puis vérifier (`workers_get_worker_code`). Toute nouvelle en-tête de
requête → l'ajouter à `corsHeaders()` (sinon `Failed to fetch` sans log) ; seul un vrai aller-
retour navigateur valide un correctif CORS. `POST /transaction` : écrit `qty`/`invested` dans
`portfolio.json` (secrets `GITHUB_WRITE_TOKEN`, `PORTFOLIO_WRITE_SECRET`, `PORTFOLIO_WRITE_URL`).
Achat/vente/correction restent symétriques ; `invested` = coût de revient, jamais le produit de
vente.

## Fichiers de données

Écrits par les routines, **ajout seulement** :
- `verdicts.json` : `pending` → `resolved` seulement après `resolves_at`. Jamais d'issue inventée.
- `engine-history.json` : `correction_log` = mémoire du moteur ; `global_stats` recalculé ;
  `routine_health.last_success_at` touché à **chaque** cycle réussi, même sans verdict.
- `news.json` : `last_checked_at` à chaque cycle ; `last_updated_at` seulement si `items` change.
- `onchain-history.json` : un jour sans aucune métrique confirmée est sauté (jamais de ligne
  nulle), jamais de backfill.
- `portfolio-history.json` : 1 point/jour écrit par la GitHub Action `portfolio-snapshot`
  (`scripts/portfolio-snapshot.mjs`, zéro quota Claude) — aucune routine ne l'écrivait depuis le 14/09.
- `portfolio.json` : **édité à la main uniquement** ; `null` + `pending: true` = à afficher en
  attente, jamais deviné.
- `portfolio-thesis.json` (`constat` + badge) ≠ `favoris-context.json` (`bull/base/bear`, **clé =
  ticker**, pas `cgId`). Les distinguer par la forme.
- Avant de proposer une nouvelle source : vérifier `data/market-context.json` (taux 10 ans, flux
  ETF, stablecoins y sont déjà).

## Routines Cowork — pièges

- La config des routines vit dans les triggers Cowork, invisible à git et non relisible. Les specs
  versionnées sont dans `docs/routines/*.md` (cycle-2h-verdict, favoris-quotidien,
  marche-quotidien) : modifier le `.md` + committer sur `main`. Changer un trigger
  (`update_trigger`) = action à confirmer avec l'utilisateur, jamais automatique.
- **Commit en 2 étapes** : la session commite sur sa branche `claude/*`, puis fusionne dans `main`
  et pousse `main`. Sans l'étape 2, invisible sur le site. Branches `claude/*` restantes : vérifier
  `git merge-base --is-ancestor` avant de conclure à un oubli.
- Outils MCP CoinGecko/Alpha Vantage/Economic Index **interdits dans les routines one-shot**
  (bloquent la session) — WebFetch + WebSearch à la place. Exception : `opportunites-quotidien`.
  Un outil qui marche en session interactive ne prouve rien pour une routine.
- Échec `rate_limit_info.status:"rejected"` = quota d'usage, pas un bug.
- Indicateur de fraîcheur en alerte → vérifier les timestamps réels sur `origin/main` avant de
  conclure qu'une routine est bloquée.
- Toujours re-vérifier une affirmation héritée (même écrite par une routine) contre une source
  live avant de l'inscrire dans la doc.
