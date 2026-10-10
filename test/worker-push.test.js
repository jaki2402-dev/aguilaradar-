import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "../cloudflare-worker/worker.js";

// Cycle de notifications du Worker (scheduled -> runPushCycle), sans réseau : fetch et le
// stockage KV sont simulés. Tous les éléments sont déjà connus, donc aucun envoi push réel.
// Bug corrigé (non déployé avant le 10/10/2026) : le simple slice(-500) sur les ids notifiés
// pouvait évincer des ids ENCORE présents dans les fichiers, re-notifiés ensuite à chaque passage.

const opportunities = { opportunities: [{ id: "o1", ticker: "AAA", reason: "test" }] };
const alerts = [
  { id: "a1", type: "seuil_technique", message: "m1" },
  { id: "a2", type: "seuil_technique", message: "m2" },
];
const CURRENT_IDS = ["opp-o1", "alert-a1", "alert-a2"];

function fakeKv(initial) {
  let stored = initial === null ? null : JSON.stringify(initial);
  return {
    get: async () => stored,
    put: async (_key, value) => {
      stored = value;
    },
    read: () => JSON.parse(stored),
  };
}

async function runCycle(kv) {
  vi.stubGlobal("fetch", async (url) => ({
    ok: true,
    json: async () => (String(url).endsWith("/opportunities.json") ? opportunities : alerts),
  }));
  const pending = [];
  const env = { PUSH_SUBSCRIPTION_JSON: "{}", PUSH_STATE: kv };
  await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cloudflare-worker — mémoire des notifications déjà envoyées", () => {
  it("ne perd jamais un id encore présent dans les fichiers, même au-delà de 500 ids mémorisés", async () => {
    const obsolete = Array.from({ length: 600 }, (_, i) => `alert-ancien-${i}`);
    const kv = fakeKv([...CURRENT_IDS, ...obsolete]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCycle(kv);
    const kept = kv.read();
    CURRENT_IDS.forEach((id) => expect(kept).toContain(id));
    expect(log).toHaveBeenCalledWith("Cycle push :", JSON.stringify({ total: 3, sent: 0, isBaseline: false }));
  });

  it("plafonne seulement les ids disparus des fichiers (500 au plus, les plus récents)", async () => {
    const obsolete = Array.from({ length: 600 }, (_, i) => `alert-ancien-${i}`);
    const kv = fakeKv([...CURRENT_IDS, ...obsolete]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCycle(kv);
    const kept = kv.read();
    expect(kept.length).toBe(CURRENT_IDS.length + 500);
    expect(kept).toContain("alert-ancien-599");
    expect(kept).not.toContain("alert-ancien-99");
  });

  it("premier passage (aucun état) : mémorise tout sans rien envoyer", async () => {
    const kv = fakeKv(null);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCycle(kv);
    expect(kv.read().sort()).toEqual([...CURRENT_IDS].sort());
    expect(log).toHaveBeenCalledWith("Cycle push :", JSON.stringify({ total: 3, sent: 0, isBaseline: true }));
  });
});
