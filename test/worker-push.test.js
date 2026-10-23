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

// POST /send-digest : la routine Cowork "aguilaradar-digest-6h" délègue son envoi à ce Worker au
// lieu de garder sa propre copie de VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY/abonnement dans son prompt
// (trouvée périmée le 23/10/2026 — figée depuis le 12/08, jamais resynchronisée avec une rotation
// de clé). Clés ci-dessous : paire P-256 générée pour ce test uniquement, sans rapport avec la
// vraie paire VAPID du projet (un secret Cloudflare, jamais lisible depuis ce dépôt).
describe("cloudflare-worker — POST /send-digest", () => {
  const subscription = {
    endpoint: "https://push.example/sub-1",
    keys: {
      p256dh: "BEiPZi33kPrbe7Jt9GtMiaJfFj2hsyNCWyyfRlZaZDfIzwDVCD8MvoNrGwPhnVcBUe-RzKK_QjoZwE2TWAPkPBs",
      auth: "wAVPYR--y-D0C01euVmWIg",
    },
  };
  const baseEnv = {
    DIGEST_PUSH_SECRET: "test-secret",
    VAPID_PUBLIC_KEY: "BM6aLgSBftsLcYnk_G_Kf-EPO2dl4ITmMJltuMrQT2u9cLXTkQhMCwcLrimkZ2VIUi1xRPyQcnajz_LydU-D-Es",
    VAPID_PRIVATE_KEY: "r-thCX1WDjgYK33n4rqfYR4M_5GkGIDVVZyek5gq0HY",
    PUSH_SUBSCRIPTION_JSON: JSON.stringify(subscription),
  };

  function req({ secret = "test-secret", body = { title: "t", body: "b" } } = {}) {
    return new Request("https://worker.example/send-digest", {
      method: "POST",
      headers: { "X-Digest-Secret": secret },
      body: JSON.stringify(body),
    });
  }

  it("refuse si le secret n'est pas configuré côté Worker (501, jamais un 401 trompeur)", async () => {
    const res = await worker.fetch(req(), { ...baseEnv, DIGEST_PUSH_SECRET: undefined });
    expect(res.status).toBe(501);
  });

  it("refuse un mauvais secret", async () => {
    const res = await worker.fetch(req({ secret: "mauvais" }), baseEnv);
    expect(res.status).toBe(401);
  });

  it("refuse un titre ou un corps vide", async () => {
    const res = await worker.fetch(req({ body: { title: "", body: "x" } }), baseEnv);
    expect(res.status).toBe(400);
  });

  it("envoie le push avec les clés et l'abonnement du Worker (pas ceux de l'appelant)", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 201, text: async () => "" }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await worker.fetch(req({ body: { title: "Résumé", body: "Rien de notable." } }), baseEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(subscription.endpoint);
  });
});
