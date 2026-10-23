# `aguilaradar-opportunites-quotidien` — criblage d'opportunités, quotidien

Routine Cowork, 04h08 UTC, **session persistante** (`persist_session: true`) — contexte qui
s'accumule au fil des jours, commence toujours par `git pull origin main`. **Seule routine du
projet autorisée à appeler l'outil MCP CoinGecko** (connecteur réellement attaché et fonctionnel
sur cette session dédiée ; toutes les autres routines l'ont dans leur liste mais ne doivent
jamais l'appeler — voir CLAUDE.md, « Routines Cowork — pièges »). Raison historique : l'appel HTTP
direct (curl/WebFetch) vers CoinGecko et 7 fournisseurs de secours est bloqué (`EGRESS_BLOCKED`)
depuis cet environnement pour cette routine.

## Rôle

Fait tourner `data/opportunities.json.opportunities` : récupère le Top 20 par capitalisation
(limite connue du connecteur — pas de `vs_currency` EUR natif, pas de variation 7j/30j/ATH
natifs), exclut memecoins/stablecoins évidents, score simple (variation 24h + bonus rang ≤ 100,
exclusion si volume/cap > 25 %), déduplique contre les `cgId` déjà présents, vise 2-5 nouveaux
candidats par cycle (0 est un résultat valide).

## Commit — toujours, même à 0 candidat

Met à jour `last_scan_at`/`scanned_count` dans tous les cas. Prix converti en EUR seulement si un
taux réel est fourni par l'outil, jamais inventé — sinon prix natif + devise notée dans `reason`.
Schéma d'une entrée : `id, ticker, name, cgId, image, price_eur, market_cap, market_cap_rank,
change_24h_pct, change_7d_pct|null, change_30d_pct|null, ath_change_pct|null, opportunity_score,
recognized, sparkline:[], tags, reason, flagged_at, price_at_flag, threshold_pct=5,
price_refreshed_at, horizons{j1,j3,j7,j14,m6}` (chaque horizon : `check_at` dérivé de `flagged_at`,
`status:"pending"`, `outcome:null`). Étape optionnelle (si budget restant) : archiver les
opportunités à score devenu très faible ou dont `m6` est déjà résolu, vers
`archived_opportunities` (déplacement intégral, jamais une simple suppression).

Résolution des `horizons` échus = **pas le rôle de cette routine** (voir `horizons-6h.md` et,
depuis le 11/10, le robot GitHub `resolve-due` sans quota qui fait l'essentiel du travail).

## Règles dures

Jamais de memecoin ; jamais un chiffre inventé (`null` plutôt que deviner) ; ne touche jamais aux
champs d'affichage d'une opportunité active sans changement ; ne touche jamais à
`index.html`/`css`/`js`/`manifest.json` ni à un autre `data/*.json`.
