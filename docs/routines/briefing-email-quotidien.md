# `aguilaradar-briefing-email-quotidien` — mail du matin, quotidien

Routine Cowork, 09h06-09h09 UTC, **session persistante** (`persist_session: true`), connecteurs
Gmail + CoinMarketCap + CoinGecko + Blockscout. **Lecture seule sur le dépôt** — n'écrit jamais de
fichier, le livrable est un vrai email (`mcp__Gmail__send_message`, jamais `create_draft`) à
`jaki2402@gmail.com`.

Correspond à **P9** de `docs/feuille-de-route.md` (vérifié à jour le 23/10/2026 : `updated_at`
du prompt stocké = 17/10/2026, donc postérieur au correctif « jauges fraîches » du 05/10 évoqué
dans l'ancien P9 — mais le contenu exact de ce correctif n'a pas été comparé ligne à ligne, à
revérifier si un doute réapparaît sur la fraîcheur des chiffres cités dans le mail).

## Rôle

Un briefing quotidien du marché (pas du portefeuille — voir `briefing-crypto-hebdo-cloud.md` pour
l'hebdo portefeuille). Données : `data/digest.json`, `data/alerts.json` (24h), `data/engine-
history.json` (`macro_regime`, `global_stats`) via raw GitHub ; marché en direct via CoinMarketCap
`get_global_metrics_latest` + CoinGecko `get-global-market` ; actualités via CoinMarketCap
`get_crypto_latest_news` + recherche web pour un évènement macro majeur.

Règle de justesse explicite dans le prompt : le titre/ton suit le marché **réel**, jamais le seul
ton du digest (le digest peut être « calme » pendant que le marché bouge) ; si le digest a plus de
12h, le signaler en tête de mail ; aucun chiffre inventé, aucun conseil d'achat/vente.

## Structure du mail

Objet `"AguilaRadar — Briefing du <date> : <résumé fidèle au marché>"`. Corps : cap totale
24h/7j + BTC/ETH/SOL + peur-cupidité (tendance 7j/30j) + dominance BTC ; titre + 2 phrases de
synthèse ; 2-4 facteurs du jour (Contexte / Ce que cela signifie / À surveiller) ; niveaux
techniques BTC si source fiable ; section moteur AguilaRadar (verdicts, alertes 24h, précision) ;
bouton vers le site ; pied avec sources + disclaimer réglementaire.

**Design partagé avec les 2 autres emails automatisés** (`alerte-crypto-quotidienne-cloud`,
`briefing-crypto-hebdo-cloud`) — même identité visuelle (bandeau `#181C24` + carré or, carte
blanche max 600px `width="100%" style="max-width:600px"` jamais un `width` fixe seul, tables HTML
imbriquées, jamais flexbox/grid, correctif mode sombre Gmail `[data-ogsc]`/`[data-ogsb]`). Toute
modification du gabarit devrait en principe être répercutée sur les 3 — non vérifié si c'est
systématiquement le cas en pratique.
