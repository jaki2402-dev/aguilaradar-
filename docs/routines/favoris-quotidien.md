# Routine Cowork : `aguilaradar-favoris-quotidien`

Cadence : quotidienne (08:20 UTC). Accès MCP : CoinGecko, Alpha Vantage, Anthropic Economic Index, Blockscout, Cloudflare Developer Platform. Dépôt : `jaki2402-dev/aguilaradar-`, écrit et commite directement dans `data/`.

Ce document est la **spécification de référence versionnée** de cette routine — il n'existait aucune version lisible/diffable de son prompt avant ce document (les routines Cowork ne sont pas lisibles via l'API, seulement écrasables — voir CLAUDE.md). À chaque évolution voulue de cette routine, modifier CE fichier d'abord, puis reporter le contenu dans la configuration de la routine (Cowork).

## Règle absolue (s'applique à tout ce document)

**Ne jamais inventer une valeur.** Si une donnée ne peut pas être confirmée par une vraie source (API directe ou résultat de recherche web réellement lu, jamais une estimation "plausible"), le champ correspondant reste `null` avec une `note` expliquant pourquoi — jamais un remplissage silencieux. Une valeur douteuse (résultat de cache visiblement obsolète, incohérente avec un cycle précédent sans explication) est signalée dans le champ `note`, jamais corrigée sans le dire.

---

## 1. `data/favoris-context.json` — contexte étendu par favori

### Forme exacte (ne jamais dévier)

```json
{
  "last_computed_at": "<ISO 8601 UTC, à chaque exécution>",
  "assets": {
    "<TICKER>": {
      "last_computed_at": "<ISO 8601 UTC — uniquement mis à jour pour les tickers réellement retraités CE cycle>",
      "competitor": { "ticker": "...", "name": "...", "comparison_note": "1-3 phrases factuelles" },
      "long_term_thesis": { "bull": "...", "base": "...", "bear": "...", "assumptions_note": "..." },
      "open_interest": { "value_usd": <number|null>, "funding_rate_pct": <number|null>, "source": "...", "note": "..." },
      "defi_tvl": { "value_usd": <number|null>, "change_7d_pct": <number|null>, "source": "...", "note": "..." },
      "onchain_signal": { "available": <bool>, "note": "...", "source_url": "<url|null>" }
    }
  }
}
```

Clé = **ticker** (BTC, ETH, ...), jamais `cgId` — c'est le seul fichier de ce dépôt dans ce cas, ne pas "corriger" vers `cgId` sans mettre à jour tous les lecteurs (`detail.js:renderFavorisContextSection`, `allocation.js`). Liste des 15 tickers : voir `FAVORIS` dans `js/config.js`.

### Rotation — règle explicite et auto-réparatrice

Ne pas retraiter les 15 favoris à chaque cycle (trop coûteux). À chaque exécution :

1. Lire `data/favoris-context.json` existant.
2. Trier les 15 tickers par `last_computed_at` croissant (un ticker jamais calculé = priorité maximale, traité comme plus ancien que tout).
3. Retraiter entièrement (les 5 champs ci-dessus) les **3 tickers les plus anciens**.

Cette règle garantit qu'aucun favori ne reste périmé plus de ~5 jours ouvrés. **Un audit du 14/09/2026 a trouvé 11 des 15 favoris avec un contexte vieux de 14 à 26 jours** — signe que la rotation réelle jusqu'ici n'a pas suivi cette règle stricte (ou n'existait pas formellement). Ce point est corrigé par cette spécification : appliquer la règle "3 plus anciens" à la lettre, sans exception, à chaque cycle.

### Sourcing

- `competitor`/`long_term_thesis` : recherche web réelle (concurrents directs, catalyseurs, risques). Jamais une extrapolation depuis la connaissance générale du modèle sans recherche.
- `open_interest`/`defi_tvl` : privilégier un appel direct à l'API source (CoinGlass pour l'open interest, DefiLlama pour la TVL) ; si l'accès réseau direct échoue (déjà arrivé, proxy de l'environnement), utiliser WebSearch pour trouver un résultat récemment indexé, et le citer explicitement `"<Source> (résultat indexé via WebSearch)"` dans `source` — jamais présenté comme un appel API direct s'il ne l'était pas.
- **Détection de résultat en cache** : si un résultat WebSearch semble identique à celui du cycle précédent alors que le marché a bougé entre-temps, le signaler dans `note` (ex. "valeur identique au cycle précédent — pourrait provenir d'une page indexée en cache, à vérifier") plutôt que de le présenter comme une vraie confirmation fraîche.
- `defi_tvl` pour un actif sans DeFi native sur sa propre chaîne (BTC, etc.) : **ne pas conclure "non applicable" sans avoir vérifié le wrapped/bridged** — DefiLlama référence aussi la valeur d'un actif *wrapped/bridged* verrouillée dans la DeFi d'AUTRES chaînes (ex. WBTC/cbBTC et l'exposition BTC sur Ethereum et ailleurs), un chiffre réel et souvent significatif, différent de la TVL native de la chaîne elle-même. Chercher ce chiffre en premier (DefiLlama : page/API "bridged"/actif wrapped concerné, sinon WebSearch ciblé comme ci-dessus) ; s'il existe, le renseigner normalement (`value_usd`, `source`) avec `note` précisant qu'il s'agit d'une exposition wrapped/bridged, pas de TVL native — jamais présenté comme si c'était la TVL de la chaîne elle-même. Seulement si aucun chiffre fiable n'est trouvé, wrapped compris : `value_usd: null`, `note` explique pourquoi — jamais `0`. Repéré le 14/09/2026 : la routine s'arrêtait jusqu'ici à "non applicable" pour BTC sans avoir cherché ce chiffre wrapped.
- `onchain_signal` : recherche ciblée d'un mouvement whale significatif (>48h non pertinent, voir `available:false` existant) via **Blockscout** (déjà accordé à cette routine) pour les tickers dont l'écosystème est couvert par Blockscout (EVM/L2 : ETH, ARB, LINK, GRT, ONDO, JUP le cas échéant, etc.). **Audit du 14/09/2026 : seul LINK avait `onchain_signal.available:true`** — objectif de cette révision : vérifier Blockscout pour CHAQUE ticker EVM-compatible retraité ce cycle (pas seulement de façon opportuniste), même si la réponse reste souvent `available:false` faute de mouvement significatif. **Correction du 15/09/2026 : INJ retiré de cette liste** — `get_chains_list` (Blockscout MCP) ne renvoie aucun résultat pour "Injective" (vérifié en direct), la chaîne Injective (Cosmos SDK) n'est pas couverte par Blockscout ; seule une "Injective EVM" existe en testnet à ce jour, pas en mainnet — ne pas réintroduire INJ ici sans revérifier. Pour les tickers hors écosystème EVM (BTC, TIA, INJ, PEAQ, AIOZ, FLUX — tous confirmés non-EVM), garder la méthode de recherche actuelle (WebSearch ciblé).

---

## 2. `data/onchain-history.json` — historique quotidien, 8 actifs avec chaîne propre

**Étendu le 15/09/2026** (ajouté le 14/09/2026 pour BTC seul, alimente les graphiques on-chain de `js/onchain.js` — `renderOnchainSection`/`ONCHAIN_OWN_CHAIN_ASSETS`). Fichier **append-only, jamais réécrit** : un snapshot réel ajouté par jour et par actif, jamais interpolé, jamais rétro-daté, jamais fabriqué si une métrique manque.

**Les 8 actifs concernés** (chaîne propre confirmée — voir le commentaire `ONCHAIN_OWN_CHAIN_ASSETS` dans `js/onchain.js` pour le raisonnement complet) : `bitcoin`, `ethereum`, `arbitrum`, `celestia`, `injective-protocol`, `peaq-2`, `aioz-network`, `zelcash` (FLUX). **7 des 15 favoris n'en font PAS partie** — `the-graph`, `cartesi`, `chainlink`, `ondo-finance`, `livepeer`, `jupiter-exchange-solana` n'ont pas de chaîne propre (jetons sur Ethereum/Solana, voir `ONCHAIN_NO_OWN_CHAIN_ASSETS`) : **ne jamais leur écrire de snapshot ici**, la métrique n'aurait pas de sens (mesurerait Ethereum/Solana en général). `fetch-ai` n'est dans AUCUNE des deux listes : statut réellement incertain (ex-chaîne propre "fetchhub", fusion ASI Alliance depuis) — **avant d'écrire quoi que ce soit pour FET, vérifier par une vraie recherche web si le jeton a encore une chaîne propre active aujourd'hui**, puis mettre à jour `ONCHAIN_OWN_CHAIN_ASSETS`/`ONCHAIN_NO_OWN_CHAIN_ASSETS` dans `js/onchain.js` en conséquence (et ce document) — ne pas se contenter de deviner ici.

### Forme exacte (même forme par actif, clé = `cgId`)

```json
{
  "assets": {
    "<cgId>": {
      "snapshots": [
        {
          "date": "YYYY-MM-DD",
          "computed_at": "<ISO 8601 UTC>",
          "tvl_usd": <number|null>,
          "tx_per_day": <number|null>,
          "active_addresses": <number|null>,
          "source": { "tvl_usd": "...", "tx_per_day": "...", "active_addresses": "..." }
        }
      ]
    }
  }
}
```

### Procédure, une fois par exécution (après la rotation des favoris ci-dessus)

Pour **chacun** des 8 `cgId` ci-dessus (pas seulement bitcoin) :

1. Vérifier qu'aucun snapshot n'existe déjà pour ce `cgId` à la date du jour (UTC) — si oui, passer à l'actif suivant (jamais deux snapshots le même jour pour le même actif, jamais un doublon écrasé).
2. Pour chacune des 3 métriques, tenter une vraie source, **par famille de chaîne** (ne jamais réutiliser une méthode d'une famille pour une autre) :
   - **bitcoin** (déjà en place, ne pas modifier) : `tvl_usd` via DefiLlama `https://api.llama.fi/v2/historicalChainTvl/bitcoin` ; `tx_per_day`/`active_addresses` via Blockchain.com (`/stats?format=json` champ `n_tx`, `/charts/n-unique-addresses?timespan=2days&format=json` dernier point).
   - **ethereum, arbitrum** (EVM, Blockscout) : utiliser l'outil MCP Blockscout déjà accordé à cette routine — `direct_api_call(chain_id="1"` pour ethereum, `"42161"` pour arbitrum`, endpoint_path="/api/v2/stats/charts/transactions")`, dernier point du tableau `chart_data` (champ `transactions_count`) pour `tx_per_day`. **Confirmé réellement le 15/09/2026 pour ethereum** (données reçues, dates et volumes réalistes) — arbitrum utilise le même produit Blockscout donc attendu identique, non revérifié séparément à ce jour : si l'appel échoue pour arbitrum spécifiquement, le signaler (`source.tx_per_day` explique l'échec) plutôt que de supposer que la méthode entière est cassée. `active_addresses` : pas d'endpoint confirmé à ce jour — chercher dans `/stats-service/api/v1/lines` (catalogue de graphiques nommés) un nom lié aux adresses actives, sinon WebSearch ; si rien de fiable, laisser `null`. `tvl_usd` : DefiLlama `https://api.llama.fi/v2/historicalChainTvl/{chain}` avec `chain` = `Ethereum`/`Arbitrum` (nom exact à confirmer sur `https://defillama.com/chains` si le premier essai échoue).
   - **celestia, injective-protocol, peaq-2, aioz-network, zelcash** : aucune source vérifiée depuis une session de développement (proxy sortant bloqué sur ces domaines lors de la rédaction de cette section — voir `js/onchain.js`, commentaire au-dessus de `ONCHAIN_OWN_CHAIN_ASSETS`). Cette routine a un vrai accès WebSearch : chercher l'explorateur public de chaque chaîne (ex. Celenium pour Celestia, l'explorateur RunOnFlux pour Flux) et sa documentation API, confirmer que l'endpoint répond réellement avant de s'en servir, puis réutiliser la même méthode aux cycles suivants une fois confirmée — documenter la source trouvée dans `source.<champ>` à chaque écriture pour que ce soit traçable.
3. Si une métrique reste incertaine après l'appel direct et une tentative WebSearch : laisser le champ à `null` et documenter la raison dans `source.<champ>` (ex. `"non confirmé ce cycle — API et WebSearch tous deux indisponibles"`) — jamais une valeur devinée.
4. **Ne jamais écrire un snapshot dont les 3 champs sont `null`** pour un actif donné — dans ce cas, ne rien ajouter ce jour pour CET actif (les autres actifs de la liste ne sont pas affectés) plutôt que d'ajouter une ligne vide qui polluerait son graphique.
5. Ajouter le nouveau snapshot à la fin du tableau `snapshots` de l'actif concerné (ordre chronologique croissant, jamais réordonné/retrié).

**Ne pas tout faire d'un coup si le budget d'appels/temps du cycle est serré** : bitcoin et ethereum/arbitrum (méthode confirmée) d'abord ; les 5 chaînes non-EVM peuvent progresser un actif de plus par cycle plutôt que de risquer un cycle incomplet ou trop long — cohérent avec la règle "jamais deviner, jamais fabriquer" de ce document : mieux vaut un actif de moins ce cycle qu'une source non vérifiée.

## 3. Commit — deux étapes obligatoires, pas juste "push"

**Piège réel, confirmé le 14/09/2026 sur `aguilaradar-cycle-2h`** (même infrastructure, donc
même risque ici) : un cycle peut produire un commit correct mais s'arrêter après l'avoir poussé
sur sa propre branche de sortie, sans jamais fusionner dans `main` — invisible sur le site en
ligne jusqu'à une intervention manuelle. "Pousse-le sur main" seul ne suffit pas comme
instruction.

Procédure en 2 étapes, obligatoires toutes les deux à chaque cycle :
1. Commit normal (un seul, sur la branche de travail courante) couvrant les fichiers modifiés
   (`data/favoris-context.json` et, si un snapshot du jour a pu être confirmé,
   `data/onchain-history.json`), message clair (ex. `"Rotation favoris + snapshot on-chain BTC du
   <date>"`).
2. **Fusionner explicitement cette branche dans `main` et pousser `main`** — `git checkout main`
   (ou équivalent), `git merge --no-ff &lt;ta-branche&gt; -m "Merge cycle &lt;date&gt; into main"`,
   `git push origin main`. Le cycle n'est pas terminé tant que cette 2e étape n'a pas réussi.
