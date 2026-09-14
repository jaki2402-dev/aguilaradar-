# Méthodologie du verdict — 5 catégories, jamais un score global inventé

Référence commune pour :
- `js/detail.js` (`renderVerdictBreakdown` — décomposition affichée sur chaque fiche).
- Une future révision du prompt de `aguilaradar-cycle-2h` (Piste B, pas faite dans cette
  session — voir "État réel des données" ci-dessous avant de s'y attaquer).

## Règle absolue

**Une catégorie sans donnée réelle suffisante affiche "Donnée insuffisante", jamais un chiffre
devine.** Un score global (une seule note combinant les 5 catégories) n'est **jamais** calculé ni
affiché tant qu'une seule des 5 catégories est "Donnée insuffisante" — le combiner masquerait
justement le manque de données derrière un chiffre qui a l'air complet. C'est la même règle déjà
appliquée dans `js/allocation.js` ("jamais un score unique à fausse précision (ex. '82/100')"),
étendue ici à la fiche verdict plutôt qu'inventée une 2e fois différemment.

## Les 5 catégories

Chacune notée 0-10 **seulement quand la règle ci-dessous est remplie**, sinon "Donnée
insuffisante" pour cette catégorie précise (pas pour la fiche entière).

### 1. Momentum

**Ce qui existe déjà, pour les 15 favoris** : `signals_used` (mouvements 24h/7j/30j),
`verdict.verdict`/`confidence_pct`, `signal_consensus.technique` (`verdicts.json`). C'est la
**seule catégorie couverte pour 15/15 favoris aujourd'hui**.

Règle de notation (quand `signal_consensus.technique` existe) :
- `technique` "haussier" + `confidence_pct` ≥ 65 → 8-10 (8 par défaut, +1 si `accord_count` ≥ 2, +1 si le mouvement 7j dépasse le seuil directionnel dans le même sens)
- `technique` "haussier" + `confidence_pct` < 65 → 6-7
- `technique` "mixte"/"neutre" → 4-6 (5 par défaut)
- `technique` "baissier" + `confidence_pct` < 65 → 3-4
- `technique` "baissier" + `confidence_pct` ≥ 65 → 0-2

Sans `signal_consensus` (verdicts émis avant le 11/08, ou champ absent) : "Donnée insuffisante"
pour cette catégorie précise plutôt que de deviner depuis `verdict.verdict` seul.

### 2. Fondamentaux

**Ce qui existe** : `long_term_thesis` (bull/base/bear, `favoris-context.json`) pour les favoris
dont la rotation l'a déjà calculé ; `portfolio-thesis.json` (`recommendation`+`conviction`)
**seulement pour les positions du portefeuille**, pas les 15 favoris ni les opportunités.

Règle (quand `portfolio-thesis.json` a une entrée pour l'actif) :
- `recommendation` "Renforcer", `conviction` ≥ 7 → 8-10
- "Renforcer" `conviction` < 7, ou "Conserver" `conviction` ≥ 7 → 6-7
- "Conserver" `conviction` < 7, ou "Attendre" → 4-5
- "Réduire" `conviction` < 7 → 2-3
- "Réduire" `conviction` ≥ 7 → 0-1

Sans entrée `portfolio-thesis.json` (la majorité des favoris, tous les non-portefeuille) :
"Donnée insuffisante" — `long_term_thesis` seule (texte bull/base/bear sans conviction chiffrée)
ne suffit pas à noter, elle reste affichée telle quelle dans "Contexte élargi", jamais transformée
en chiffre ici.

### 3. Tokenomics

**État réel (2026-09-14) : aucune donnée structurée n'existe nulle part dans ce dépôt.**
`FAVORIS[].utility` (`config.js`) décrit narrativement *comment* un token capture de la valeur
(ARB = gouvernance pure, INJ = rachat-destruction hebdo, etc.) mais ne donne ni supply, ni
inflation, ni calendrier d'unlocks, ni concentration des holders. **Cette catégorie affiche
systématiquement "Donnée insuffisante" pour les 15 favoris tant que cette lacune n'est pas
comblée** — ne pas la noter à partir du texte `utility` narratif, ce serait une extrapolation, pas
une mesure.

### 4. Valorisation

**Ce qui existe** : `market_cap`, `ath_change_pct` (`opportunities.json`, pas `verdicts.json`) ;
`defi_tvl.value_usd` pour 3/15 favoris aujourd'hui (`favoris-context.json`) ; `tvl_usd` pour BTC
uniquement via `data/onchain-history.json` (nouveau, 2026-09-14 — vide au départ, voir
`js/onchain.js`).

Règle (uniquement quand market cap ET une mesure d'activité réelle — TVL ou volume 24h/marketcap —
sont toutes deux disponibles pour cet actif précis) :
- ratio marketcap/activité dans le premier tiers de sa fourchette observée sur l'actif → 7-10 (attractif)
- tiers médian → 4-6 (raisonnable)
- dernier tiers → 0-3 (cher/difficile à justifier)

Sans les deux termes du ratio pour cet actif précis : "Donnée insuffisante" — ne jamais comparer
un marketcap à une activité d'un AUTRE actif ou à une moyenne de secteur non calculée ici.

### 5. Risque

**Ce qui existe** : `signal_precoce.threshold_crossed` (`verdicts.json`), désaccord verdict/thèse
(`VERDICT_THESIS_CONFLICTS`, `allocation.js`), concentration déjà détenue
(`THRESHOLDS.concentrationWarningPct`, portefeuille seulement). Rien sur dilution/unlocks
(dépend de Tokenomics ci-dessus, absent) ni concurrence/dépendance à un narratif (jamais mesuré
nulle part).

Règle (annotation, pas un score 0-10 classique — trop peu de dimensions réelles pour une échelle
fine) : `"faible"` si aucun signal ci-dessus n'est présent, `"modéré"` si un seul, `"élevé"` si
deux ou plus (signal précoce défavorable + désaccord verdict/thèse, par exemple). Jamais
"Donnée insuffisante" ici — l'absence de signal négatif connu EST l'information, contrairement
aux autres catégories où l'absence de donnée n'est pas un renseignement.

## Ce que ça donne concrètement aujourd'hui (honnête, pas optimiste)

Pour la quasi-totalité des 15 favoris/opportunités : Momentum seul est noté, Fondamentaux noté
seulement pour les positions du portefeuille, Tokenomics et Valorisation "Donnée insuffisante"
pour presque tous, Risque toujours annoté. **Aucun score global n'apparaît nulle part avant que
ça change** — c'est le comportement voulu, pas un bug d'affichage à corriger plus tard.

## Prochaines étapes pour combler les lacunes (pas faites dans cette session)

1. Tokenomics : aucune source identifiée dans l'audit actuel — nécessiterait une nouvelle
   recherche (supply/unlocks par token, CoinGecko a parfois `max_supply`/`circulating_supply` en
   direct, insuffisant seul pour les unlocks).
2. Fondamentaux au-delà du portefeuille : étendre `portfolio-thesis.json` (ou une entrée
   équivalente) aux 15 favoris, pas seulement aux positions détenues — changement de périmètre
   pour la routine `aguilaradar-these-portefeuille-hebdo`, à décider avec l'utilisateur d'abord
   (elle s'appelle "portefeuille", pas "favoris").
3. Valorisation : se remplit organiquement à mesure que `data/onchain-history.json` accumule des
   points réels pour BTC ; pour les autres favoris, dépend d'une source TVL/activité par
   écosystème, pas encore identifiée.
