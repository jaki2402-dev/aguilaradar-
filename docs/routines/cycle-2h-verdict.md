# Routine Cowork : `aguilaradar-cycle-2h`

Cadence : toutes les 8h depuis le 03/10/2026 (00:15, 08:15, 16:15 UTC ; le nom garde "2h", legacy — 2h→4h le 06/09, 4h→8h le 03/10
pour le coût IA, voir `REFRESH.deepCycleHours` dans `config.js`). Accès MCP : CoinGecko, Alpha
Vantage, Cloudflare Developer Platform. Dépôt : `jaki2402-dev/aguilaradar-`, écrit et commite
directement dans `data/verdicts.json` et `data/engine-history.json`.

Spécification de référence versionnée (même principe que `docs/routines/favoris-quotidien.md`) —
modifier CE fichier + committer avant toute nouvelle révision du prompt de cette routine, jamais
un `update_trigger` à l'aveugle sans passer par ici d'abord.

## Démarrage économe — à faire en PREMIER (quota hebdo épuisé fin septembre 2026)

Ne jamais lire `data/verdicts.json` (~156 Ko) ni `engine-history.json` en entier. Commencer par :

```bash
python3 - <<'EOF'
import json, datetime
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
v = json.load(open("data/verdicts.json"))
pending = [x for x in v if x.get("status") == "pending"]
due = [x["id"] for x in pending if x["resolves_at"] <= now]
covered = {x["ticker"] for x in pending}
print("dus:", due); print("tickers sans verdict pending:", sorted({x["ticker"] for x in v} - covered))
EOF
```

- **Rien de dû et aucun ticker sans verdict pending** → cycle court : seulement §7 (santé), §8
  en version courte (1 recherche hack/exploit + fear&greed, pas plus), §9 (commit). Pas de lecture
  de `favoris-context.json`/`market-context.json`, pas de recherche de prix.
- Sinon : traiter uniquement les tickers concernés ; prix des tickers concernés en UN seul appel (`vs_currencies=usd,eur` :
  USD pour émettre, la devise du verdict pour résoudre) groupé ; lire seulement l'entrée du ticker dans `favoris-context.json`/`portfolio-thesis.json`
  (extraction `python3`), et `market-context.json` une seule fois par cycle.
- **Plafond après une interruption (quota épuisé, cycles manqués)** : résoudre TOUS les verdicts
  dus (peu coûteux : un seul appel de prix groupé), mais **émettre au plus 3 nouveaux verdicts par
  cycle**, en priorité les tickers sans verdict pending depuis le plus longtemps. Les suivants
  attendent les cycles d'après. Raison : le 28/09, 9 verdicts émis d'un coup au redémarrage ont
  brûlé le quota juste récupéré, et des verdicts émis ensemble arrivent à échéance ensemble
  (pic qui se reproduit tous les 14 jours) — étaler les émissions casse ce cycle.
- Écrire toutes les modifications JSON par script `python3` (load → modifier → dump
  `ensure_ascii=False, indent=2`) puis `python3 -m json.tool <fichier> >/dev/null`. Ne jamais
  réafficher un fichier entier.

## Contexte de performance (résumé — détail dans `docs/journal-technique.md`)

Au 14/09/2026 l'exactitude stricte (26,8 %) était sous la baseline « classe majoritaire » (42,9 %)
et `confidence_pct` concentré à 88 % sur 50/60 : corrigé par la formule du §2. Au 21/09, la
sélection ACHAT/ATTENTE/VENTE restait biaisée vers ATTENTE (~79 % des verdicts, jamais VENTE sur
signal baissier) : corrigé par la sous-section « Sélection » du §2.

## Règle absolue (s'applique à tout ce document)

**Ne jamais inventer un prix, un signal ou une donnée.** Un signal non confirmé par une vraie
source (CoinGecko, Alpha Vantage) est absent de `signals_used`, jamais deviné. Un désaccord entre
sources n'est jamais résolu en choisissant arbitrairement — il devient un signal de plus (accord
plus faible, confiance plus basse), jamais masqué.

## 1. Forme exacte de `data/verdicts.json` (ne pas dévier)

Tableau au niveau racine, chaque entrée :

```json
{
  "id": "v-<date>-<ticker en minuscules>",
  "issued_at": "<ISO 8601 UTC>",
  "asset": "<cgId>",
  "ticker": "<TICKER>",
  "verdict": "ACHAT | ATTENTE | VENTE",
  "horizon_days": <14 par défaut, 7 si l'horizon adaptatif s'applique — voir section 3>,
  "confidence_pct": <0-100, voir section 2 pour la règle de calcul>,
  "signals_used": ["<phrase courte et factuelle par signal réellement observé>"],
  "reasoning": "<3-6 phrases, cite les chiffres réels utilisés>",
  "resume": "<1 phrase, ≤ 160 caractères, l'essentiel du raisonnement — voir la section « Champ resume » en fin de document>",
  "price_at_issue": <prix réel au moment de l'émission, en USD>,
  "currency": "USD",
  "resolves_at": "issued_at + horizon_days jours",
  "status": "pending",
  "threshold_pct": 5,
  "regime_at_issue": "risk-on | neutre | risk-off",
  "signal_consensus": { "technique": "haussier|baissier|mixte|neutre", "fondamental": "...", "macro": "...", "accord_count": <0-3> },
  "technical_at_issue": { "as_of": "<ISO>", "source": "technical-favoris", "rsi14": <number|null>, "sma200_gap_pct": <number|null>, "macd": "haussier|baissier|null" } | null
}
```

**Devise — règle absolue (bug réel du 20/09/2026)** : `price_at_issue` est **toujours en USD**
(`vs_currencies=usd`) et `"currency": "USD"` est **obligatoire** sur chaque nouveau verdict. Avant
le 20/09 les verdicts étaient émis en EUR, puis le cycle est passé à l'USD sans le dire : 14
verdicts émis en € ont été résolus avec un prix en $, ce qui ajoutait ~16 % fictifs au mouvement
mesuré. Le symbole écrit dans `reasoning` n'est **pas** une preuve de devise (des prix en € y ont été
écrits « $ ») — seul le champ `currency` fait foi. Écrire dans `reasoning` le même symbole que
`currency`.

`threshold_pct` reste **toujours 5** (le défaut de `THRESHOLDS.directionalMovePct`, `config.js`)
dans cette révision — **ne pas introduire de seuil variable par actif** : ça demanderait une
formule de volatilité qui n'a jamais été validée sur ce projet, un risque non maîtrisé de plus
alors que l'exactitude est déjà sous la baseline. Le champ `threshold_pct` existe précisément pour
qu'un futur seuil variable soit traçable verdict par verdict le jour où cette formule existera et
aura été validée — pas aujourd'hui.

## 2. `confidence_pct` — une formule reproductible, pas un chiffre à l'instinct

Reprend exactement la section "Momentum" de `docs/verdict-methodology.md`, dans l'autre sens
(cette fois pour PRODUIRE `confidence_pct`, pas pour le noter a posteriori) :

- `signal_consensus.accord_count` = 3 (technique + fondamental + macro tous d'accord) → 75-85 %
- `accord_count` = 2 → 60-70 %
- `accord_count` = 1 → 45-55 %
- `accord_count` = 0 (signaux qui se contredisent) → **le verdict devient ATTENTE**, `confidence_pct` 40-50 % — ne pas forcer un ACHAT/VENTE quand les 3 dimensions ne s'accordent pas, voir section 4.

Ne jamais sortir de ces fourchettes pour "faire un chiffre rond" — choisir une valeur précise
dans la fourchette selon la force réelle des signaux (ex. un mouvement de prix net + volume
confirmé pèse plus qu'un mouvement de prix seul), documentée en une phrase dans `reasoning` si le
choix dans la fourchette n'est pas évident.

### Sélection ACHAT/ATTENTE/VENTE — le trou réel, pas juste `confidence_pct` (trouvé le 21/09/2026)

**Ce document n'a jamais dit, explicitement, comment `signal_consensus.technique` devient le
verdict final (`ACHAT`/`ATTENTE`/`VENTE`).** Seule la formule de confiance ci-dessus était
spécifiée, en supposant le verdict déjà choisi. Dans les faits, ce choix non écrit s'est révélé
systématiquement prudent, dans un sens qui ne colle pas à ce qui s'est réellement passé :

- Sur les 56 verdicts résolus au 21/09/2026, `technique = "baissier"` a mené à ATTENTE 10 fois sur
  10, **jamais** à VENTE — alors que 14 des 56 résolutions réelles (25 %) étaient effectivement une
  baisse au-delà du seuil.
- `accord_count = 1` (32 cas sur 56, le groupe le plus fréquent) a mené à ATTENTE 32 fois sur 32 —
  alors que la section ci-dessus ne force ATTENTE qu'à `accord_count = 0`, jamais à 1.
- Conséquence mesurée : 44 des 56 verdicts résolus (78,6 %) sont ATTENTE, alors que seulement 10
  des 56 résolutions réelles (17,9 %) sont effectivement restées sous le seuil — le moteur
  s'abrite dans ATTENTE près de 5x plus souvent que ce que le marché a réellement fait sur cette
  période (couverture actuelle : 21 %).
- Ce biais est **antérieur ET postérieur** à `corr-20260914-confidence-formule-reproductible`
  (44/56 = 78,6 % avant, 12/15 = 80 % après) : la formule de confiance a résolu la concentration
  sur 50/60 %, un vrai problème, mais n'a jamais touché ce mécanisme-ci — deux trous distincts.

**Règle, à partir de cette révision** — un seul levier, directement branché sur
`signal_consensus.technique` qui existe déjà, sans introduire de nouvelle donnée ni de formule
numérique inventée :

- `technique = "haussier"` et `accord_count ≥ 1` → le verdict **doit** être `ACHAT` (jamais ATTENTE
  par prudence).
- `technique = "baissier"` et `accord_count ≥ 1` → le verdict **doit** être `VENTE` (jamais ATTENTE
  par prudence).
- `technique` ∈ {"mixte", "neutre", "insuffisant", "a_risque_retournement", "peu_fiable"} →
  ATTENTE, comme aujourd'hui (aucun changement ici, cette partie n'est pas le problème).
- `accord_count = 0` → ATTENTE reste forcé (règle existante ci-dessus, inchangée).

**Ne pas confondre avec la section 4** : le plafonnement d'`accord_count` à 1 en cas de
contradiction avec `favoris-context.json`/`portfolio-thesis.json` reste inchangé et s'applique
normalement AVANT cette règle — un `technique` haussier plafonné à `accord_count = 1` par la
section 4 donne toujours ACHAT (accord_count ≥ 1), pas ATTENTE : seul `accord_count = 0`
(contradiction totale entre les 3 dimensions) annule la direction.

**Pourquoi ce choix et pas un autre** : c'est la lecture technique déjà calculée et déjà écrite
(`signal_consensus.technique`) qui décide, jamais une nouvelle mesure inventée. Si cette règle se
révèle mauvaise (ACHAT/VENTE plus souvent faux qu'ATTENTE ne l'était), ce sera visible dans
`accuracy_strict_pct` du prochain lot résolu et devra être documenté honnêtement dans
`correction_log` — comme `corr-20260906-test-horizon-adaptatif` puis
`corr-20260913-biais-chasse-momentum` l'ont déjà fait pour l'horizon adaptatif. **Ne pas juger
cette règle avant qu'un lot d'au moins ~10 verdicts émis sous elle ait atteint son horizon** (7-14
jours) — même principe que `MIN_RESOLVED_FOR_SELF_ASSESSMENT` côté site (`js/engine.js`).

**Fausse alerte vérifiée et classée le 21/09/2026** : `v-20260807-btc` et `v-20260807-eth` portent
un `signal_precoce.note` (déjà en place depuis leur émission) signalant un écart de ~16-17 % entre
leur `price_at_issue` et une double vérification faite le 10/08. Revérifié le 21/09 via l'historique
CoinGecko réel (`/coins/bitcoin/history` et `/coins/ethereum/history`, 07/08/2026) : BTC 55 764 €
contre `price_at_issue` stocké 55 800 (écart 0,06 %), ETH 1 650,60 € contre 1 649,89 stocké (écart
0,04 %) — **les deux prix stockés sont corrects**, l'écart était dans la note d'origine, pas dans
la donnée. Cause : la note du 10/08 comparait `price_at_issue` en euros à des sources citées en
dollars (~64-65k$, qui correspondent en fait à 64 262,75 $ confirmés par CoinGecko pour cette même
date — cohérent, juste dans l'autre devise) sans convertir. Aucune correction de `price_at_issue`
ou `outcome` nécessaire ; `signal_precoce.note` des deux verdicts complétée d'une ligne pointant
vers cette réévaluation plutôt que réécrite, pour garder la trace de ce qui a été cru puis vérifié.

## 3. Horizon adaptatif — déjà en place, ne pas casser

`horizon_days` = 7 plutôt que 14 pour les actifs identifiés comme volatils lors de la correction
`corr-20260906-test-horizon-adaptatif` (voir `engine-history.json.correction_log`) — **cette
logique fonctionne et reste en place telle quelle**, cette révision ne la touche pas. Continuer à
consulter `correction_log` à chaque cycle avant d'émettre un nouveau verdict sur un actif
récemment corrigé.

## 4. Croiser avec les données déjà écrites ailleurs — nouveau dans cette révision

Avant de finaliser un verdict sur un ticker, lire (lecture seule, déjà commitées par d'autres
routines, aucun nouvel appel réseau requis) :
- `data/favoris-context.json[ticker].long_term_thesis` (bull/base/bear) et `.onchain_signal`
- `data/portfolio-thesis.json.positions[cgId]` (recommendation + conviction), si l'actif y figure

Si la lecture technique de ce cycle **contredit franchement** l'un de ces deux (ex. signal
technique haussier net mais thèse hebdo "Réduire" avec conviction ≥7, ou l'inverse) : le noter
explicitement dans `reasoning` ("Signal technique haussier mais thèse hebdo Réduire — contexte à
surveiller") et **ne pas dépasser `accord_count` = 1** pour ce verdict, même si `technique` seul
semblait net — un signal technique fort qui va à l'encontre d'une recherche fondamentale réelle
n'est pas un signal fort au sens de ce document. Un accord (technique et thèse alignés) ne change
rien au calcul de la section 2, mais renforce la légitimité du `reasoning`.

**Ne jamais** transformer ce croisement en une 2e opinion inventée — c'est une lecture de deux
données déjà réelles, jamais une extrapolation au-delà de ce qu'elles disent.

### `signal_consensus.macro`/`regime_at_issue` — dériver de `data/market-context.json`, pas du seul fear & greed

**Constat du 15/09/2026 : ce document n'a jamais dit comment déterminer `regime_at_issue`, et les
cycles récents (lus dans `routine_health.last_failure_reason`) le déduisaient uniquement de
l'indice fear & greed** — un baromètre de sentiment, alors que `data/market-context.json`
(écrit par `aguilaradar-marche-quotidien`, lecture seule, aucun nouvel appel réseau requis) contient
des données macro bien plus rigoureuses, déjà collectées et déjà affichées sur le site (Moteur →
Contexte marché) mais jamais lues par cette routine : `fed_policy` (taux directeur, `stance`
hawkish/dovish/neutral, rendement du Trésor 10 ans, date de la prochaine réunion FOMC),
`etf_flows` (flux nets ETF spot BTC/ETH, avec détail par émetteur), `stablecoins` (capitalisation
totale, dominance), `gold` (prix spot, ratio BTC/or). Ignorer ce fichier revient à juger la
"macro" avec le signal le plus faible disponible alors que le plus solide existe déjà à côté.

**À chaque cycle, avant de fixer `signal_consensus.macro` et `regime_at_issue` sur CHAQUE verdict
du cycle (le contexte macro est le même pour tous, pas la peine de le relire par ticker)** :

1. Lire `data/market-context.json` en entier (`fed_policy`, `etf_flows`, `stablecoins` au minimum).
2. Combiner qualitativement, jamais avec une formule numérique inventée (même principe que
   `signal_consensus` en général — un désaccord entre signaux est montré, jamais masqué par un
   score composite) :
   - `fed_policy.stance` "hawkish" + rendement 10 ans en hausse marquée → pression vers `risk-off`
     (coût du capital plus élevé, moins favorable aux actifs à risque).
   - `etf_flows` nets positifs et croissants sur BTC/ETH → pression vers `risk-on` (demande
     institutionnelle réelle, indépendante du sentiment retail).
   - `stablecoins.dominance_pct` en hausse (la part du marché total en stablecoins augmente) →
     signal `risk-off` (capital qui se met en attente plutôt que déployé) ; en baisse → `risk-on`.
   - Fear & greed reste un signal parmi d'autres, jamais le seul — le combiner avec les 3
     ci-dessus, pas le remplacer par eux ni l'ignorer.
3. **Ces signaux ne s'alignent pas toujours — un cas réel rencontré le 15/09 : Fed hawkish + 10 ans
   ayant brièvement dépassé 5 % (plus haut depuis 2023) pointent `risk-off`, alors que les flux ETF
   BTC/ETH sont nets positifs sur plusieurs séances, ce qui pointe `risk-on`.** Dans ce genre de cas,
   retenir `neutre` plutôt que de forcer une lecture, et **le dire explicitement** dans le
   `reasoning` du verdict concerné (ex. "Régime macro neutre : Fed toujours restrictive et
   rendement 10 ans au plus haut depuis 2023, mais flux ETF BTC/ETH nets positifs — signaux macro
   contradictoires, retenus comme tels plutôt que tranchés arbitrairement") — jamais résoudre la
   contradiction en choisissant le signal qui arrange le verdict déjà envisagé.
4. Un événement macro imminent et connu (ex. `fed_policy.next_fomc_date` dans les 24-48h) mérite
   une mention explicite dans `reasoning` même sans trancher le régime — un verdict émis juste
   avant une décision Fed importante porte un risque différent d'un verdict émis juste après,
   information utile même si elle ne change pas `signal_consensus.macro` en soi.

## 5. Résolution des verdicts en attente

À chaque cycle, pour tout verdict `status:"pending"` dont `resolves_at` est dépassé : calculer
`actual_move_pct` depuis `price_at_issue` et le prix réel actuel **dans la devise du champ
`currency` du verdict** (USD → `vs_currencies=usd`, EUR → `eur` ; jamais un prix d'une devise
comparé à un prix d'une autre). Verdict **sans** champ `currency` (émis avant cette règle) :
devise établie le 04/10/2026 sur l'historique CoinGecko réel, pas sur le texte — émis **avant le
20/09/2026 → EUR** ; émis **à partir du 20/09/2026 → USD**, **sauf CTSI (`cartesi`) → EUR**
(`v-20260922-ctsi`, `v-20261003-ctsi`). Résoudre dans cette devise. Puis remplir `outcome` en entier
(`price_at_resolution`, `actual_move_pct`, `actual_direction`, `verdict_correct`,
`resolved_at`) — jamais un remplissage partiel (voir `test/data-fixtures.test.js`, qui rejette
déjà un verdict résolu avec un `outcome` incomplet).

## 6. `correction_log` — mémoire d'un cycle à l'autre, pas un ajout systématique

**N'ajouter une entrée que lors d'un vrai changement de procédure/paramètre tenté**, jamais à
chaque cycle. Réutiliser exactement la forme déjà en place (`id, logged_at, trigger, what, why,
validation_score_before_pct, validation_score_after_pct, action, status`). Quand un lot de
verdicts affectés par une correction précédente se résout, **revenir sur l'entrée correspondante**
et renseigner son `validation_score_after_pct` plutôt que de créer une entrée séparée — c'est ce
qui a déjà été fait pour `corr-20260906` (fermé par `corr-20260913`), continuer sur ce modèle.

Vu l'exactitude actuelle sous la baseline (section "Contexte de performance" ci-dessus), une
fois un lot de verdicts émis sous cette révision (croisement + confidence_pct reproductible)
résolu en nombre suffisant, logger honnêtement si l'exactitude s'est améliorée, dégradée, ou n'a
pas bougé de façon significative — jamais présenter une amélioration qui ne serait pas
statistiquement confirmée par les chiffres réels.

## 7. `engine-history.json.routine_health` — à jour à CHAQUE cycle, même sans verdict émis

Le bandeau de fraîcheur du site lit `routine_health.last_success_at` (alerte au-delà de 12h) ; un
champ figé a déjà produit une fausse alerte « routine bloquée » (15/09). **À la fin de CHAQUE
cycle sans erreur — y compris un cycle court sans rien de dû — mettre `last_success_at` à l'heure
de fin et `consecutive_failures` à 0.** `last_failure_reason` peut porter un résumé court (1-2
phrases) du cycle.

**`engine-history.json.macro_regime` — seulement dans un cycle qui émet au moins un verdict**
(le régime vient d'y être déterminé pour `regime_at_issue`, §4 : aucun appel ni recherche en plus).
Recopier par script `python3` : `last_computed_at` (heure du cycle), `regime` (le même que
`regime_at_issue`), `note` (1-2 phrases : pourquoi ce régime). Ne pas toucher à `fear_greed_value`
ni `btc_dominance_pct` : le site lit ces jauges dans `data/market-gauges.json` (GitHub Action
`price-alerts`, 4×/jour). Cycle court : ne rien écrire ici — le site affiche alors le régime comme
« évalué le JJ/MM », c'est voulu. (Bloc resté figé du 14/09 au 04/10/2026 parce que cette étape
avait disparu de la spec.)

**Ne plus écrire** `paper_portfolio_stats` ni `global_stats.baseline_buy_hold_btc_pct` : le site
les calcule désormais en direct (`computePaperPortfolio`, `js/engine.js`, même formule que celle
que la routine utilisait).

## 8. `data/news.json` — veille actualités

### Forme exacte

```json
{
  "last_checked_at": "<ISO 8601 UTC — À CHAQUE cycle, que quelque chose de nouveau soit trouvé ou non>",
  "last_updated_at": "<ISO 8601 UTC — SEULEMENT quand `items` change réellement>",
  "items": [ { "title": "...", "resume": "<1 phrase, voir la section « Champ resume » en fin de document>", "url": "...", "source": "..." } ]
}
```

`last_checked_at` prouve que la veille a eu lieu ; `last_updated_at` date le dernier vrai
changement d'`items`. Un `last_updated_at` plus ancien est normal ; un `last_checked_at` figé ne
l'est jamais (fausse alerte du 15/09).

### Procédure, une fois par exécution

1. Recherche ciblée (fear&greed, dominance, actualité générale, hack/exploit) — **2 à 4 recherches
   maximum** (2 en cycle court) : chercher un développement réellement nouveau et significatif
   (produit majeur, hack, régulation, mouvement institutionnel), jamais une reformulation d'un item
   existant (comparer aux seuls `title` via `python3`, pas en lisant le fichier).
2. Si trouvé : l'ajouter à `items` (`title` factuel, `url` réelle, `source`) et mettre à jour
   `last_updated_at`.
3. **Toujours** mettre à jour `last_checked_at` à l'heure de fin du cycle.
4. `items` n'est pas append-only : garder au plus ~10 items réellement notables, retirer les plus
   anciens.

## 9. Commit — deux étapes obligatoires, pas juste "push"

Un cycle s'est déjà arrêté après le commit sur sa branche de sortie, invisible sur le site
jusqu'à fusion manuelle (14/09). Les 2 étapes sont obligatoires à chaque cycle :
1. Commit normal (un seul, sur la branche de travail courante) couvrant les fichiers modifiés,
   message clair (ex. "Cycle du &lt;date&gt; : N verdicts émis, M résolus").
2. **Fusionner explicitement cette branche dans `main` et pousser `main`** — `git checkout main`
   (ou équivalent), `git merge --no-ff &lt;ta-branche&gt; -m "Merge cycle &lt;date&gt; into main"`,
   `git push origin main`. Le cycle n'est pas terminé tant que cette 2e étape n'a pas réussi.

## Champ `resume` (actif depuis le 11/10/2026)

Une phrase « l'essentiel », affichée en tête par le site (le texte complet reste dépliable). Cette
section fait partie de la spécification : elle s'applique à chaque cycle, sans autre action.

1. Chaque NOUVEAU verdict de data/verdicts.json reçoit "resume" : la raison principale du verdict et
   le point de vigilance éventuel, en une phrase.
2. Chaque NOUVEL item ajouté à data/news.json reçoit "resume" : l'actualité en une phrase.
3. Quand tu écris engine-history.json.macro_regime, ajoute "resume" : le régime retenu et sa raison
   principale, en une phrase.

Les verdicts et actualités déjà écrits ne sont jamais modifiés (historique permanent). Règles du
champ "resume" : une seule phrase en français correct (accents), 160 caractères maximum, l'essentiel
en premier ; écrite uniquement à partir du texte complet que tu viens d'écrire (aucun chiffre ni fait
absent de ce texte) ; jamais de conseil d'achat ou de vente ; écrite par le même script python3 que
le reste. Si tu ne peux pas résumer fidèlement, n'écris pas de "resume" : le site affichera le début
du texte.

## Analyse technique du robot quotidien (active depuis le 11/10/2026)

`data/technical-favoris.json` est écrit chaque soir à 23h30 UTC par un robot GitHub
(`scripts/technical-favoris.mjs`, aucun quota, aucun connecteur) : pour chaque favori (clé = ticker),
tendance de fond (écart à la moyenne 200 jours), RSI 14 j, MACD, évolutions 7 j → 1 an, volatilité,
repli depuis le plus haut sur 1 an, et une phrase `reading`. Pourquoi : jusqu'ici le cycle ne voyait
que les évolutions 24 h / 7 j / 30 j (exemple réel : CTSI émis ACHAT le 10/10 avec un RSI à 71 et un
cours 30 % au-dessus de sa moyenne 200 j, sans que rien ne le signale).

1. Pour chaque favori sur lequel tu émets un verdict, lis seulement son entrée, par extraction
   python3 (jamais le fichier entier) :
   `python3 -c "import json;d=json.load(open('data/technical-favoris.json'));print(d['updated_at']);print(json.dumps(d['assets'].get('TICKER'),ensure_ascii=False))"`
   Si le fichier manque, si l'actif n'y est pas ou si `updated_at` date de plus de 36 h : écris
   `"technical_at_issue": null` et passe à la suite, rien d'autre ne change.
2. Sinon, ajoute au verdict `"technical_at_issue": {"as_of": <as_of de l'actif>, "source":
   "technical-favoris", "rsi14": <rsi14>, "sma200_gap_pct": <sma200_gap_pct>, "macd": "haussier" si
   macd_histogram > 0, "baissier" s'il est < 0, sinon null}` — valeurs recopiées par le script
   python3 qui écrit le verdict, jamais retapées à la main ni devinées.
3. Ajoute la phrase `reading` de l'actif, telle quelle, dans `signals_used`.
4. Dans `reasoning`, signale tout signal du robot qui contredit le verdict : RSI14 >= 70 (surachat)
   sur un ACHAT, RSI14 <= 30 (survente) sur une VENTE, cours sous sa moyenne 200 j sur un ACHAT ou
   au-dessus sur une VENTE, MACD de sens opposé au verdict.
5. Ne change PAS la règle de décision ACHAT / ATTENTE / VENTE ni le calcul de `confidence_pct` :
   corr-20260921 est en évaluation jusqu'au 20/10 et doit rester la seule variable modifiée. Ces
   données documentent chaque verdict et permettront de mesurer, sur les issues réelles, si elles
   prédisent mieux que la lecture actuelle (candidat d'auto-correction après le 20/10).
6. Chiffres en USD et en pourcentages : ne les compare jamais à un prix en euros. Ne modifie jamais
   `data/technical-favoris.json` (fichier du robot).
