// Charge les vrais fichiers js/*.js dans un contexte JSDOM isolé, en respectant la
// sémantique réelle des <script> classiques du navigateur : portée lexicale globale
// PARTAGÉE entre tous les fichiers chargés dans le même `dom` (comme sur la vraie page,
// où index.html charge js/config.js, js/engine.js, etc. l'un après l'autre), mais une
// portée fraîche et isolée pour chaque test (pas de fuite d'état entre deux tests).
//
// Vérifié empiriquement (pas supposé) avant d'écrire ce fichier, avec deux mécanismes
// candidats :
//   1. dom.window.eval(code) pour chaque fichier — NE MARCHE PAS pour ce qu'on veut : dans
//      l'implémentation jsdom/Node vm actuelle, chaque appel .eval() séparé reçoit sa propre
//      portée lexicale de haut niveau pour `const`/`let`, jamais partagée avec un appel
//      .eval() précédent (seuls `var` et les déclarations `function` survivent d'un appel à
//      l'autre, via l'objet global partagé). Or config.js expose FAVORIS/SECTORS/THRESHOLDS
//      en `const`, et prices.js/assistant.js ont des variables d'état en `let` (ex.
//      latestFavorisPrices) lues par d'autres fichiers — cassé avec cette approche.
//   2. Injecter de vraies balises <script> (document.createElement("script") + textContent
//      + appendChild) — reproduit fidèlement le vrai navigateur : toutes les balises
//      <script> d'une même page partagent UNE seule portée lexicale globale persistante,
//      donc un `const`/`let` de haut niveau déclaré dans un fichier reste lisible/réassignable
//      par les fichiers suivants. C'est ce que fait réellement index.html. Retenu.
//
// Contrepartie de l'injection de <script> : une erreur dans le code chargé n'est PAS
// relancée comme une exception JS normale à l'appel de appendChild (vérifié : jsdom l'avale
// et la journalise via son virtualConsole). On branche donc un virtualConsole qui capture
// jsdomError et la relance nous-mêmes juste après, pour qu'un fichier cassé fasse échouer le
// test avec un message clair plutôt que de laisser des fonctions silencieusement absentes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const JS_DIR = path.join(ROOT, "js");

const DEFAULT_URL = "https://aguilaradar.test/";

// dom fraîche, sans script chargé — l'appelant choisit ensuite quoi charger via loadScripts.
export function createPage({ url = DEFAULT_URL, html = "<!doctype html><html><body></body></html>" } = {}) {
  const virtualConsole = new VirtualConsole();
  // Transmet console.log/warn/error du code chargé vers la vraie console (utile si une
  // fonction testée logue une erreur réseau attendue), sans dupliquer les erreurs jsdom
  // internes qu'on gère nous-mêmes juste en dessous.
  virtualConsole.sendTo(console, { omitJSDOMErrors: true });
  let lastError = null;
  virtualConsole.on("jsdomError", (err) => {
    lastError = err;
  });
  const dom = new JSDOM(html, { url, runScripts: "dangerously", virtualConsole });
  dom.__getLastError = () => lastError;
  dom.__clearLastError = () => {
    lastError = null;
  };
  return dom;
}

// Exécute `code` comme une vraie balise <script> de la page (voir note en tête de fichier
// sur pourquoi pas dom.window.eval). Relance toute erreur interceptée par virtualConsole.
function runAsScriptTag(dom, code, label) {
  dom.__clearLastError();
  const scriptEl = dom.window.document.createElement("script");
  scriptEl.textContent = code;
  dom.window.document.body.appendChild(scriptEl);
  const err = dom.__getLastError();
  if (err) {
    const wrapped = new Error(`Échec d'exécution (${label}) : ${err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

// Charge une liste de fichiers js/*.js (relatifs à js/), dans l'ordre donné, dans le
// contexte global partagé de `dom`. L'ordre doit refléter celui d'index.html quand les
// fichiers chargés dépendent les uns des autres (ex: engine.js utilise escapeHtml de
// config.js) — sinon une ReferenceError claire et immédiate le signale.
export function loadScripts(dom, fileNames) {
  for (const name of fileNames) {
    const code = readFileSync(path.join(JS_DIR, name), "utf8");
    runAsScriptTag(dom, code, `js/${name}`);
  }
  return dom;
}

// Raccourci : crée la page ET charge les scripts en un appel.
export function loadPage(fileNames, opts) {
  const dom = createPage(opts);
  loadScripts(dom, fileNames);
  return dom;
}

// Affecte une variable globale `const`/`let` de haut niveau depuis l'extérieur — impossible
// via dom.window.nom = valeur (un const/let de haut niveau d'un <script> classique n'est
// JAMAIS exposé comme propriété de window, y compris dans un vrai navigateur : essayer
// `let x=1` puis `window.x` en console le confirme). On exécute donc une réaffectation (pas
// une redéclaration) comme balise <script> supplémentaire, qui partage la même portée
// lexicale globale que les fichiers déjà chargés. Limité aux valeurs sérialisables en JSON
// (suffisant pour des fixtures de test).
export function setGlobal(dom, name, value) {
  runAsScriptTag(dom, `${name} = ${JSON.stringify(value)};`, `setGlobal(${name})`);
}

// Lit une variable globale `const`/`let` de haut niveau depuis l'extérieur — même
// contrainte que setGlobal, dans l'autre sens. On exécute une balise <script> de plus qui
// recopie la valeur sur window (une simple affectation de propriété, license aucune règle
// de portée), puis on la relit et on nettoie derrière nous.
let readCounter = 0;
export function getGlobal(dom, name) {
  const key = `__test_read_${readCounter++}__`;
  runAsScriptTag(dom, `window.${key} = (typeof ${name} !== "undefined" ? ${name} : undefined);`, `getGlobal(${name})`);
  const value = dom.window[key];
  delete dom.window[key];
  return value;
}
