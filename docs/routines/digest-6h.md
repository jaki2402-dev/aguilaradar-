# `aguilaradar-digest-6h` — résumé périodique + push, 2×/jour

Routine Cowork, 06h05 et 18h05 UTC, **session fraîche** (`persist_session: false`). Seul fichier
`data/` qu'elle a le droit d'écrire : `data/digest.json` (schéma : `generated_at`, `headline`
≤ 60 car., `summary` ≤ 400-500 car., `tips[]` ≤ 100 car. chacun (1-3), `market_tone`). Aucune
nouvelle recherche web ni appel prix : lit uniquement ce que les autres routines ont déjà écrit
(extraction `python3` ciblée sur `verdicts.json`/`engine-history.json`/`opportunities.json`/
`alerts.json`/`news.json`/`market-context.json`, jamais un `cat` des gros fichiers).

## P1 de `docs/feuille-de-route.md` — push cassé depuis le 12/08, correctif prêt le 23/10/2026

**État au 23/10/2026, avant que l'utilisateur colle le nouveau prompt** : l'étape 3 (push) de
cette routine garde encore sa propre copie figée (12/08) d'une paire de clés VAPID + d'un
abonnement, jamais resynchronisée avec aucune rotation de clé côté site — un abonnement push est
verrouillé à la clé publique utilisée à sa création, donc cette copie signe des push qu'aucun
service de push n'accepte plus. L'étape 2 (écriture de `digest.json`) n'est **pas** affectée :
elle réussit indépendamment, le push est seulement la cerise qui manque.

**Correctif prêt, pas encore collé** : un nouveau texte d'étape 3 délègue l'envoi à la route
`POST /send-digest` du Worker Cloudflare (secret `DIGEST_PUSH_SECRET`, voir CLAUDE.md § Relais IA)
au lieu de garder une copie de secrets dans ce prompt. Tant que ce texte n'est pas collé dans
`claude.ai/code/routines/trig_01PieLv3mQo3T9K3CskGpSd4` (action utilisateur, voir P1), l'étape 3
continue d'échouer en silence exactement comme décrit ci-dessus — sans bloquer l'étape 2.

## Piège git propre à cette routine

`git push origin HEAD:main` **explicitement**, jamais juste `git push` — sans ça le commit part
sur une branche dérivée et n'atteint jamais le site (déjà arrivé une fois). Si même
`HEAD:main` est refusé, le prompt demande de rapporter l'erreur exacte plutôt que d'abandonner
silencieusement.

## Règles dures

Jamais de memecoin recommandé ; jamais un chiffre inventé ; `tips` informatifs uniquement, jamais
un conseil financier réglementé ; ne modifie jamais `index.html`/`css`/`js`/`manifest.json`/
`favicon.svg`/`sw.js` ni un autre `data/*.json`.
