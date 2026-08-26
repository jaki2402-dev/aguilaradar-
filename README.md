# aguilaradar

Radar de marché crypto autonome — analyse en continu, verdicts horodatés, moteur qui s'auto-évalue et s'auto-corrige, et (depuis le 25/08/2026) le portefeuille personnel de l'utilisateur avec valeur/latent/P&L en direct et conseils par position — complété (depuis le 26/08/2026) d'une vraie thèse fondamentale hebdomadaire par position, issue d'une recherche web réelle plutôt que du moteur ou du chat IA.

Construit à l'origine séparé d'Horizon (le tableau de bord de portefeuille personnel — pas un dépôt, un fichier `portefeuille-dashboard-v10.jsx` local déployé à la main sur Netlify) sur le principe qu'aguilaradar ne contenait aucun montant € personnel. L'utilisateur a explicitement choisi d'abandonner ce principe pour l'onglet Portefeuille : la précision des prix sur Horizon n'était pas satisfaisante, et il préfère un seul endroit avec son gain/perte latent en direct plutôt que deux tableaux de bord à maintenir. Le reste de la séparation reste vrai (aguilaradar ne reprend ni le briefing macro d'Horizon ni son déploiement Netlify) — seul le modèle de données qty/investi par position a été repris, saisi manuellement (jamais déduit, jamais connecté à un vrai compte/wallet). Le dépôt étant public, ces chiffres sont exposés comme le reste des fichiers `data/*.json` (voir "Portail d'accès" ci-dessous) — un choix assumé par l'utilisateur, pas un oubli.

## Pourquoi ce projet existe

Netlify (Horizon) et Lovable (Macroscope) sont tous les deux à court de crédits au moment où ce projet démarre (2026-08-07). aguilaradar est construit pour ne plus jamais dépendre d'un crédit qui s'épuise :

- **Hébergement** : GitHub Pages — gratuit à vie, aucun système de crédit.
- **Automatisation** : routines Cowork programmées (cloud, RemoteTrigger) — le même mécanisme déjà prouvé fiable sur Horizon, zéro dépendance au PC de l'utilisateur.
- **Base de données** : ce dépôt Git lui-même. Chaque cycle écrit des fichiers JSON dans `data/` et les commite. Rien n'est jamais écrasé ni remis à zéro — tout l'historique reste accessible même après plusieurs jours d'absence.

## Portail d'accès — ce qu'il protège vraiment

Le dépôt est **public** (condition pour que l'hébergement GitHub Pages soit gratuit et que les routines cloud puissent y écrire directement — confirmé sur Horizon : elles ne peuvent pas écrire dans un dépôt privé). Un code d'accès (haché en SHA-256 dans `js/auth.js`, jamais stocké en clair) bloque l'affichage tant qu'il n'est pas saisi.

**Important** : ce n'est pas une vraie sécurité. Le code haché reste visible dans le code source public, et les fichiers JSON dans `data/` sont de toute façon consultables directement via l'URL brute GitHub (`raw.githubusercontent.com/...`) indépendamment du portail. Ça filtre un visiteur qui tombe sur le lien par hasard, pas quelqu'un de déterminé. Si une vraie confidentialité est nécessaire un jour, la seule solution est un dépôt privé + Cloudflare Pages + un petit relais applicatif (les routines cloud ne peuvent pas écrire en Git sur un dépôt privé).

## Les deux vitesses du site

- **Instantané** : prix et graphiques (fetch direct CoinGecko/Binance + widget TradingView, côté navigateur, à chaque ouverture).
- **Par cycle programmé** : verdicts, screening Top 300, moteur de backtest — nécessitent un vrai raisonnement (lecture d'actus, analyse), pas instantané au clic. Cadence cible : pouls rapide (prix/seuils) toutes les 5-15 min, cycle profond (verdicts/analyse) toutes les 2h.

## Schémas de données (`data/`)

### `verdicts.json` — journal des verdicts, append-only

Chaque verdict émis par le moteur, jamais supprimé. Champs clés : `verdict` (ACHAT/ATTENTE/VENTE), `horizon_days`, `confidence_pct`, `signals_used`, `reasoning`, `price_at_issue`, `resolves_at`, puis `outcome` rempli seulement une fois l'horizon atteint (`status` passe de `"pending"` à `"resolved"`).

Un verdict ne peut être noté juste/faux qu'après que son horizon soit passé — le tableau de bord doit toujours afficher "en attente" plutôt qu'inventer un résultat prématuré.

### `engine-history.json` — auto-évaluation et journal des corrections

`global_stats` : recalculé à chaque cycle à partir des verdicts résolus (exactitude stricte, comparaison à deux baselines — deviner la classe majoritaire, et buy&hold BTC —, taux de couverture, F1 par classe, matrice de confusion).

`correction_log` : **append-only, jamais écrasé** — chaque tentative d'ajustement du moteur (quoi, pourquoi, score de validation avant/après, statut rejetée/appliquée). C'est la mémoire du moteur d'une exécution à l'autre.

Contrairement au prototype Macroscope observé (qui retente des réglages toutes les quelques minutes sur la même fenêtre historique fixe — risque de sur-ajustement), une nouvelle tentative de correction n'a lieu qu'à un rythme raisonnable et seulement quand de nouveaux résultats réels se sont accumulés depuis la dernière fois.

### `opportunities.json` — screening Top 300 hors memecoin

Généré par cycle profond : filtre CoinGecko catégorie "Meme" exclue, score d'opportunité, signaux, raison.

### `alerts.json` — alertes de seuil

Déclenchées par le pouls rapide (RSI, cassure de support/résistance, imbalance de carnet d'ordres) — pas besoin d'un cycle d'analyse complet pour ces alertes.

### `portfolio.json` — portefeuille personnel de l'utilisateur

Seul fichier `data/` **édité à la main** (par l'utilisateur, ou par Claude à sa demande explicite après partage de captures à jour) plutôt que par une routine programmée. Contient uniquement `qty` et `invested` (capital réellement engagé) par position — jamais un prix, une valeur ou un P&L, toujours recalculés en direct côté client (`js/portfolio.js`) à partir du prix live, jamais stockés. Une position avec `qty`/`invested` à `null` et `pending: true` signifie que les vrais chiffres n'ont pas encore été fournis — l'interface l'affiche comme "en attente", n'invente jamais un nombre à la place.

Les deux routines qui envoient le portefeuille par mail (`briefing-crypto-hebdo-cloud`, hebdomadaire, et `alerte-crypto-quotidienne-cloud`, toutes les 4h) lisent ce fichier en lecture seule via l'URL brute GitHub — jamais elles ne le modifient ni ne recalculent `qty`/`invested`.

### `portfolio-thesis.json` — thèse fondamentale hebdomadaire, réellement recherchée

Seul fichier de ce dépôt écrit directement par une routine Cowork (`briefing-crypto-hebdo-cloud`), à la demande explicite de l'utilisateur, pour donner à l'Assistant et au site une vraie analyse à horizon moyen terme — le moteur, lui, ne calcule qu'un verdict technique à ~14 jours, jamais plusieurs horizons distincts. Forme : `{ generated_at, positions: { <cgId>: { recommendation, conviction, constat } } }`, `recommendation` ∈ {Renforcer, Conserver, Attendre, Réduire}, `conviction` sur 10, `constat` = 2-3 phrases issues d'une vraie recherche web (concurrents, catalyseurs, risques) — jamais une extrapolation du chat IA, qui n'a par ailleurs aucun accès web (voir CLAUDE.md). Une position absente de ce fichier n'a simplement pas encore de thèse — ni le site ni l'Assistant n'en inventent une à sa place.

## Correction connue : ID CoinGecko du FLUX

`flux` (utilisé dans la skill Horizon actuelle) correspond en réalité à **Datamine FLUX**, un token différent. Le bon identifiant pour le Flux/Zelcash suivi par l'utilisateur est **`zelcash`** (vérifié via `/api/v3/search`, 2026-08-07). À corriger aussi côté Horizon.

## Seuil unique de "mouvement directionnel"

Une seule valeur (`THRESHOLDS.directionalMovePct` dans `config.js`) sert de seuil dans tout le site — jamais deux seuils différents selon le tableau (défaut observé chez Macroscope : ±3 % sur la matrice de confusion, ±10 % sur le tableau "réussite par verdict", ce qui sème la confusion).

## Tests

`npm install && npm test` (Vitest + jsdom, en devDependency uniquement — le site déployé reste des fichiers statiques sans aucune étape de build). Les fichiers `js/*.js` n'étant pas des modules, les tests chargent les vrais fichiers dans une page JSDOM isolée via `test/helpers/loadPage.js`, qui reproduit fidèlement le chargement `<script>` classique (portée lexicale globale partagée entre fichiers, une page fraîche par test). CI : `.github/workflows/tests.yml` sur chaque push/PR.

Couvre la logique pure (calculs RSI/MM/corrélation/matrice de confusion, échappement HTML, dédoublonnage des notifications, correspondance de tickers) et fixe par des tests de régression plusieurs bugs déjà corrigés une fois (indicateur de fraîcheur, alarme prématurée du moteur, accumulation d'écouteurs, stats Opportunités post-migration, faux positifs de tickers courts) pour qu'ils ne puissent pas revenir silencieusement. Volontairement hors périmètre : `background-fx.js` (décoratif) et les appels réseau eux-mêmes.

## État actuel / prochaines étapes

1. Scaffold local (ce commit) — fait.
2. Créer le dépôt GitHub public `aguilaradar`, push, activer GitHub Pages.
3. Configurer les routines Cowork (pouls rapide + cycle profond) qui écrivent dans `data/` et commitent.
4. Laisser le temps aux premiers verdicts d'atteindre leur horizon avant d'attendre une matrice de confusion peuplée.

## Avertissement

Analyse automatisée à titre informatif — ne constitue pas un conseil en investissement réglementé. Aucune exécution d'ordre réelle, uniquement des simulations. Aucun memecoin recommandé.
