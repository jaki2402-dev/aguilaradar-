# Relais IA gratuit — déploiement

Ce Worker donne à l'Assistant du site un vrai modèle d'IA en dernier recours, sans payer et sans
exposer de clé API publiquement (voir `CLAUDE.md` pour pourquoi une clé dans le code du site
serait dangereuse). Tout se fait dans l'interface web de Cloudflare, aucune ligne de commande.

## Étapes

1. Va sur [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Créer** →
   **Créer un Worker**.
2. Donne-lui un nom (ex. `aguilaradar-assistant-ia`) → **Déployer** (le contenu par défaut
   n'importe pas, on le remplace à l'étape suivante).
3. **Modifier le code** (bouton en haut à droite de la page du Worker) → sélectionne tout le
   code présent → colle le contenu de `worker.js` (ce dossier) à la place → **Déployer**.
4. Toujours sur la page du Worker : **Paramètres** → **Liaisons** (Bindings) → **Ajouter** →
   **Workers AI** → nom de variable `AI` (exactement ce nom, en majuscules) → **Déployer**.
5. En haut de la page du Worker, copie l'URL affichée (ressemble à
   `https://aguilaradar-assistant-ia.<ton-compte>.workers.dev`).
6. Dans le dépôt du site, ouvre `js/config.js`, trouve la ligne
   `let AI_RELAY_URL = "https://REMPLACE-MOI.workers.dev";` et remplace l'URL par celle copiée
   à l'étape 5. Commit + push sur `main` (ou demande à Claude de le faire avec l'URL).

## Vérifier que ça marche

Dans l'Assistant du site, pose une question qui ne correspond à rien de suivi (ex. "raconte-moi
une blague sur le bitcoin"). Avant : message générique "je réponds à partir de ce que le radar a
déjà analysé...". Après : une vraie réponse générée, avec la mention "(Réponse générée par IA...)"
à la fin pour la distinguer d'un verdict vérifié du moteur.

## Si quelque chose ne va pas

Le chat ne casse jamais à cause de ça : si le Worker n'est pas encore configuré, mal configuré,
ou en panne, l'Assistant retombe silencieusement sur son comportement actuel (aucune régression
possible, voir `fetchLiveAiFallback` dans `js/assistant.js`). Pas de panique si un test échoue
pendant la mise en place.
