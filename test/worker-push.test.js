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

// Paire P-256 générée pour ces tests uniquement (voir /send-digest et /subscribe plus bas), sans
// aucun rapport avec la vraie paire VAPID du projet (un secret Cloudflare, jamais lisible depuis
// ce dépôt) — nécessaire pour exercer réellement signVapidJwt/encryptWebPush (WebCrypto), pas une
// valeur à copier ailleurs.
const TEST_VAPID_PUBLIC_KEY = "BM6aLgSBftsLcYnk_G_Kf-EPO2dl4ITmMJltuMrQT2u9cLXTkQhMCwcLrimkZ2VIUi1xRPyQcnajz_LydU-D-Es";
const TEST_VAPID_PRIVATE_KEY = "r-thCX1WDjgYK33n4rqfYR4M_5GkGIDVVZyek5gq0HY";

// Vraie carte par clé (23/10/2026) : runPushCycle lit désormais 2 clés distinctes dans PUSH_STATE
// (notified_ids ET live_subscription, voir getCurrentSubscription) — un seul "stored" partagé
// entre les deux aurait fait lire l'une à la place de l'autre. read() garde son usage d'origine
// (notified_ids, seule clé que les tests existants lisaient) comme valeur par défaut.
function fakeKv(initialNotifiedIds) {
  const store = new Map();
  if (initialNotifiedIds !== null) store.set("notified_ids", JSON.stringify(initialNotifiedIds));
  return {
    get: async (key) => (store.has(key) ? store.get(key) : null),
    put: async (key, value) => {
      store.set(key, value);
    },
    read: (key = "notified_ids") => JSON.parse(store.get(key)),
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
// de clé).
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
    VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
    PUSH_SUBSCRIPTION_JSON: JSON.stringify(subscription),
    // getCurrentSubscription lit toujours PUSH_STATE en premier (voir worker.js) : même une
    // route qui n'écrit jamais dans KV a besoin du binding pour lire le filet de secours.
    PUSH_STATE: fakeKv(null),
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

// POST /subscribe (23/10/2026) : capture automatique de l'abonnement transmis par js/notify.js
// dès qu'il est (re)créé, pour ne plus dépendre du copier-coller manuel dans le secret
// PUSH_SUBSCRIPTION_JSON. PAS une vraie sécurité (code et site publics) : vérif d'Origin + limite
// de fréquence seulement, voir handleSubscribeRequest.
describe("cloudflare-worker — POST /subscribe", () => {
  const ALLOWED_ORIGIN = "https://jaki2402-dev.github.io";
  const validSubscription = {
    endpoint: "https://web.push.apple.com/abc",
    keys: { p256dh: "BEiPZi33kPrbe7Jt9GtMiaJfFj2hsyNCWyyfRlZaZDfIzwDVCD8MvoNrGwPhnVcBUe-RzKK_QjoZwE2TWAPkPBs", auth: "wAVPYR--y-D0C01euVmWIg" },
  };

  function req({ origin = ALLOWED_ORIGIN, body = validSubscription } = {}) {
    return new Request("https://worker.example/subscribe", {
      method: "POST",
      headers: origin === null ? {} : { Origin: origin },
      body: JSON.stringify(body),
    });
  }

  it("refuse une origine différente de celle du site (filtre anti-curieux, pas une vraie protection)", async () => {
    const res = await worker.fetch(req({ origin: "https://attaquant.example" }), { PUSH_STATE: fakeKv(null) });
    expect(res.status).toBe(401);
  });

  it("refuse un abonnement de forme invalide (endpoint non https, clés manquantes)", async () => {
    const kv = fakeKv(null);
    const res1 = await worker.fetch(req({ body: { endpoint: "http://pas-https.example", keys: { p256dh: "x", auth: "y" } } }), { PUSH_STATE: kv });
    expect(res1.status).toBe(400);
    const res2 = await worker.fetch(req({ body: { endpoint: "https://ok.example" } } ), { PUSH_STATE: fakeKv(null) });
    expect(res2.status).toBe(400);
  });

  it("plafonne à 20 tentatives par heure", async () => {
    const kv = fakeKv(null);
    const env = { PUSH_STATE: kv };
    for (let i = 0; i < 20; i++) {
      const res = await worker.fetch(req(), env);
      expect(res.status).toBe(200);
    }
    const res21 = await worker.fetch(req(), env);
    expect(res21.status).toBe(429);
  });

  it("stocke un abonnement valide dans PUSH_STATE, repris par le cycle push à la place du secret statique", async () => {
    // notified_ids=[] (pas null) : pas un premier passage, donc runPushCycle envoie vraiment —
    // sinon isBaseline=true n'aurait jamais appelé sendPushNotification, et le test ne prouverait
    // rien sur QUEL abonnement est utilisé.
    const kv = fakeKv([]);
    const subscribeRes = await worker.fetch(req(), { PUSH_STATE: kv });
    expect(subscribeRes.status).toBe(200);
    expect(kv.read("live_subscription")).toEqual(validSubscription);

    const pushEndpointsUsed = [];
    vi.stubGlobal("fetch", async (url) => {
      const u = String(url);
      if (u.endsWith("opportunities.json")) return { ok: true, json: async () => opportunities };
      if (u.endsWith("alerts.json")) return { ok: true, json: async () => alerts };
      pushEndpointsUsed.push(u);
      return { ok: true, status: 201, text: async () => "" };
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const pending = [];
    await worker.scheduled({}, {
      PUSH_STATE: kv,
      VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
      // Volontairement un abonnement différent et invalide : prouve que getCurrentSubscription
      // préfère bien le KV (live_subscription) à ce secret statique dès que le KV en a un.
      PUSH_SUBSCRIPTION_JSON: JSON.stringify({ endpoint: "https://ne-doit-jamais-etre-appele.example", keys: { p256dh: "z", auth: "z" } }),
    }, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);

    expect(pushEndpointsUsed.length).toBeGreaterThan(0);
    expect(pushEndpointsUsed.every((u) => u === validSubscription.endpoint)).toBe(true);
  });
});
