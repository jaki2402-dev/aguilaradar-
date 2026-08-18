import { describe, it, expect, beforeEach } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { createPage, loadScripts, runScript } from "./helpers/loadPage.js";

// jsdom (v25, cette version) expose window.crypto mais PAS crypto.subtle, ni TextEncoder en
// global (vérifié empiriquement : sha256Hex lève d'abord "Cannot read properties of undefined
// (reading 'digest')", puis "TextEncoder is not defined" une fois subtle patché). auth.js est
// le seul fichier du site à en dépendre (sha256Hex), jamais testé jusqu'ici pour cette raison.
// On complète avec les vraies implémentations de Node (node:crypto webcrypto, TextEncoder
// global de Node), pas un mock maison — mêmes primitives que dans un vrai navigateur.
function patchSubtleCrypto(dom) {
  dom.window.crypto.subtle = webcrypto.subtle;
  dom.window.TextEncoder = TextEncoder;
}

const GATE_HTML = `<!doctype html><html><body>
  <div id="access-gate">
    <form id="access-form">
      <input id="access-input" />
      <span id="access-error"></span>
    </form>
  </div>
  <div id="app-root" style="display:none"></div>
</body></html>`;

const SESSION_KEY = "aguilaradar_access_ok";

// Le digest crypto.subtle réel (webcrypto de Node, pas un mock) est authentiquement
// asynchrone — un unique setTimeout(0) après dispatchEvent("submit") n'attend pas forcément
// assez longtemps pour que le handler async ait fini de résoudre. On attend la condition
// réelle plutôt qu'un délai fixe deviné.
async function waitFor(predicate, { timeout = 1000, interval = 5 } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
}

describe("auth.js — sha256Hex", () => {
  let dom;
  beforeEach(() => {
    dom = createPage({ html: GATE_HTML });
    patchSubtleCrypto(dom);
    loadScripts(dom, ["config.js", "auth.js"]);
  });

  it("matches Node's propre SHA-256 (API createHash, indépendante de webcrypto) pour une chaîne simple", async () => {
    const expected = createHash("sha256").update("test-code-123", "utf8").digest("hex");
    const actual = await dom.window.sha256Hex("test-code-123");
    expect(actual).toBe(expected);
  });

  it("matches Node's SHA-256 pour une chaîne vide et une chaîne avec accents/emoji", async () => {
    for (const input of ["", "café ☕ crypto"]) {
      const expected = createHash("sha256").update(input, "utf8").digest("hex");
      const actual = await dom.window.sha256Hex(input);
      expect(actual).toBe(expected);
    }
  });

  it("renvoie une chaîne hex de 64 caractères en minuscules (format attendu pour la comparaison avec ACCESS_HASH)", async () => {
    const actual = await dom.window.sha256Hex("n'importe quoi");
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("auth.js — isUnlocked", () => {
  let dom;
  beforeEach(() => {
    dom = createPage({ html: GATE_HTML });
    patchSubtleCrypto(dom);
    loadScripts(dom, ["config.js", "auth.js"]);
  });

  it("is false when nothing is stored yet", () => {
    expect(dom.window.isUnlocked()).toBe(false);
  });

  it("is true once the exact session key is set to '1'", () => {
    dom.window.sessionStorage.setItem(SESSION_KEY, "1");
    expect(dom.window.isUnlocked()).toBe(true);
  });

  it("is false for any other stored value (not just missing)", () => {
    dom.window.sessionStorage.setItem(SESSION_KEY, "true");
    expect(dom.window.isUnlocked()).toBe(false);
  });

  it("is false, never throws, when sessionStorage itself is inaccessible (répliquant la navigation privée)", () => {
    dom.window.sessionStorage.getItem = () => {
      throw new Error("blocked storage");
    };
    expect(() => dom.window.isUnlocked()).not.toThrow();
    expect(dom.window.isUnlocked()).toBe(false);
  });
});

describe("auth.js — initGate / formulaire d'accès (bout en bout)", () => {
  let dom;
  beforeEach(() => {
    dom = createPage({ html: GATE_HTML });
    patchSubtleCrypto(dom);
    loadScripts(dom, ["config.js", "auth.js"]);
  });

  it("skips the form entirely and shows the app straight away when a valid session already exists", () => {
    dom.window.sessionStorage.setItem(SESSION_KEY, "1");
    let initAppCalled = false;
    dom.window.initApp = () => {
      initAppCalled = true;
    };
    dom.window.initGate();
    expect(dom.window.document.getElementById("access-gate").style.display).toBe("none");
    expect(dom.window.document.getElementById("app-root").style.display).toBe("");
    expect(initAppCalled).toBe(true);
  });

  it("rejects a wrong code : shows 'Code incorrect.', clears the input, never unlocks the session", async () => {
    dom.window.initGate();
    const input = dom.window.document.getElementById("access-input");
    const form = dom.window.document.getElementById("access-form");
    input.value = "definitely-the-wrong-code";
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => dom.window.document.getElementById("access-error").textContent !== "");

    expect(dom.window.document.getElementById("access-error").textContent).toBe("Code incorrect.");
    expect(input.value).toBe("");
    expect(dom.window.isUnlocked()).toBe(false);
    expect(dom.window.document.getElementById("access-gate").style.display).not.toBe("none");
  });

  it("accepts the correct code : persists the session, hides the gate, shows the app", async () => {
    dom.window.initGate();
    // Le vrai code en clair est un secret jamais présent dans le dépôt (voir README "Portail
    // d'accès") : on ne peut pas le taper ici. On remplace donc sha256Hex par un stub qui
    // renvoie toujours ACCESS_HASH, pour exercer la branche "code correct" sans deviner ni
    // exposer le secret réel — via runScript, pas setGlobal (ACCESS_HASH est un const, et
    // setGlobal ne sait de toute façon injecter que des valeurs sérialisables en JSON, pas une
    // fonction).
    runScript(dom, "sha256Hex = async () => ACCESS_HASH;", "stub sha256Hex");
    let initAppCalled = false;
    dom.window.initApp = () => {
      initAppCalled = true;
    };
    const input = dom.window.document.getElementById("access-input");
    const form = dom.window.document.getElementById("access-form");
    input.value = "peu importe la valeur tapée, sha256Hex est stubbé";
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => dom.window.sessionStorage.getItem(SESSION_KEY) === "1");

    expect(dom.window.sessionStorage.getItem(SESSION_KEY)).toBe("1");
    expect(dom.window.document.getElementById("access-gate").style.display).toBe("none");
    expect(dom.window.document.getElementById("app-root").style.display).toBe("");
    expect(initAppCalled).toBe(true);
  });
});
