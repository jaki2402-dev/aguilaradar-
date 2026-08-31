import { describe, it, expect, beforeEach } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

// Fausse API Notification : enregistre chaque appel plutôt que d'ouvrir une vraie
// notification système (indisponible dans jsdom de toute façon).
function installFakeNotification(dom) {
  function FakeNotification(title, opts) {
    FakeNotification.calls.push({ title, opts });
    this.onclick = null;
    this.close = () => {};
  }
  FakeNotification.permission = "granted";
  FakeNotification.calls = [];
  dom.window.Notification = FakeNotification;
  return FakeNotification;
}

describe("notify.js — checkForNewOpportunities (dedup + suppression de baseline)", () => {
  let dom, FakeNotification;
  const opportunities = {
    opportunities: [
      { id: "opp-1", ticker: "ADA", reason: "Momentum" },
      { id: "opp-2", ticker: "SOL", reason: "Breakout" },
    ],
  };
  const alerts = [
    { id: "a1", type: "opportunite", ticker_ou_theme: "BTC", message: "Signal fort", triggered_at: "2026-08-17T00:00:00Z" },
    { id: "a2", type: "seuil_technique", ticker_ou_theme: "ETH", message: "RSI franchi", triggered_at: "2026-08-17T00:00:00Z" },
  ];

  beforeEach(() => {
    dom = loadPage(["notify.js"]);
    FakeNotification = installFakeNotification(dom);
  });

  it("never notifies on the very first (baseline) run — only records what already exists", () => {
    dom.window.checkForNewOpportunities(opportunities, alerts, true);
    expect(FakeNotification.calls).toHaveLength(0);
  });

  it("does not re-notify for items already seen on a later, non-baseline run", () => {
    dom.window.checkForNewOpportunities(opportunities, alerts, true);
    dom.window.checkForNewOpportunities(opportunities, alerts, false);
    expect(FakeNotification.calls).toHaveLength(0);
  });

  it("notifies exactly once for a genuinely new opportunity that appears later", () => {
    dom.window.checkForNewOpportunities(opportunities, alerts, true);
    const withNewOne = { opportunities: opportunities.opportunities.concat([{ id: "opp-3", ticker: "DOT", reason: "Nouveau" }]) };
    dom.window.checkForNewOpportunities(withNewOne, alerts, false);
    expect(FakeNotification.calls).toHaveLength(1);
    expect(FakeNotification.calls[0].title).toBe("Nouvelle opportunité");
    expect(FakeNotification.calls[0].opts.body).toContain("DOT");
  });

  it("only treats alert types 'opportunite' and 'signal_precoce' as notifiable — never notifies for e.g. 'seuil_technique'", () => {
    // alerts contient un id "a2" de type seuil_technique, jamais vu, jamais baseline :
    // ne doit jamais generer de notification, meme apres plusieurs cycles.
    dom.window.checkForNewOpportunities({ opportunities: [] }, alerts, true);
    dom.window.checkForNewOpportunities({ opportunities: [] }, alerts, false);
    expect(FakeNotification.calls).toHaveLength(0);
  });
});

describe("notify.js — checkDigest (même forme de dédup que checkForNewOpportunities, jamais testée)", () => {
  let dom, FakeNotification;

  beforeEach(() => {
    // config.js pour DATA_URLS.digest (lu par checkDigest) - pas app.js, dont checkDigest n'a
    // besoin que de loadJson : on le stub directement plutôt que de charger tout app.js pour ça.
    dom = loadPage(["config.js", "notify.js"]);
    FakeNotification = installFakeNotification(dom);
  });

  function stubDigest(digest) {
    dom.window.loadJson = async () => digest;
  }

  it("never notifies on the very first digest ever seen — only records it (même garde-fou anti-avalanche que checkForNewOpportunities)", async () => {
    stubDigest({ generated_at: "2026-08-17T06:00:00Z", headline: "Marché stable", summary: "RAS.", tips: [] });
    await dom.window.checkDigest();
    expect(FakeNotification.calls).toHaveLength(0);
  });

  it("does not re-notify when checked again with the exact same generated_at", async () => {
    const digest = { generated_at: "2026-08-17T06:00:00Z", headline: "Marché stable", summary: "RAS.", tips: [] };
    stubDigest(digest);
    await dom.window.checkDigest();
    await dom.window.checkDigest();
    expect(FakeNotification.calls).toHaveLength(0);
  });

  it("notifies exactly once when a genuinely new digest (later generated_at) appears", async () => {
    stubDigest({ generated_at: "2026-08-17T06:00:00Z", headline: "Marché stable", summary: "RAS.", tips: [] });
    await dom.window.checkDigest();
    stubDigest({ generated_at: "2026-08-17T12:00:00Z", headline: "Rotation sectorielle", summary: "Du mouvement.", tips: [] });
    await dom.window.checkDigest();
    expect(FakeNotification.calls).toHaveLength(1);
    expect(FakeNotification.calls[0].title).toBe("Rotation sectorielle");
    expect(FakeNotification.calls[0].opts.body).toBe("Du mouvement.");
  });

  it("does nothing and never throws when there is no digest yet (null or missing generated_at)", async () => {
    stubDigest(null);
    await dom.window.checkDigest(); // rejetterait et ferait échouer le test s'il levait
    expect(FakeNotification.calls).toHaveLength(0);

    stubDigest({});
    await dom.window.checkDigest();
    expect(FakeNotification.calls).toHaveLength(0);
  });
});

describe("notify.js — urlBase64ToUint8Array", () => {
  const dom = loadPage(["notify.js"]);

  it("round-trips a byte sequence encoded independently via Buffer (ground truth, not hand-typed base64)", () => {
    const bytes = [72, 101, 108, 108, 111, 33, 63]; // "Hello!?"
    const base64url = Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const decoded = Array.from(dom.window.urlBase64ToUint8Array(base64url));
    expect(decoded).toEqual(bytes);
  });
});

describe("notify.js — updateNotifBellBadge / renderDigestPanel / clearNotifBellBadge", () => {
  const LAST_VIEWED_KEY = "aguilaradar_notif_last_viewed_at";
  let dom;

  beforeEach(() => {
    dom = loadPage(["config.js", "notify.js"], {
      html: `<!doctype html><html><body><span id="notif-bell-badge" hidden></span><div id="digest-panel"></div></body></html>`,
    });
  });

  it("counts only alerts strictly newer than the last-viewed timestamp", () => {
    dom.window.localStorage.setItem(LAST_VIEWED_KEY, "2026-08-17T00:00:00Z");
    const newer = [
      { triggered_at: "2026-08-17T01:00:00Z" },
      { triggered_at: "2026-08-17T02:00:00Z" },
      { triggered_at: "2026-08-17T03:00:00Z" },
    ];
    const older = [{ triggered_at: "2026-08-16T23:00:00Z" }];
    dom.window.updateNotifBellFromAlerts(newer.concat(older));
    const badge = dom.window.document.getElementById("notif-bell-badge");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("3");
  });

  it("caps the displayed count at '9+' beyond 9", () => {
    dom.window.localStorage.setItem(LAST_VIEWED_KEY, "2026-08-17T00:00:00Z");
    const many = Array.from({ length: 11 }, (_, i) => ({ triggered_at: `2026-08-18T${String(i).padStart(2, "0")}:00:00Z` }));
    dom.window.updateNotifBellFromAlerts(many);
    expect(dom.window.document.getElementById("notif-bell-badge").textContent).toBe("9+");
  });

  it("adds exactly one to the count when a newer periodic digest exists, on top of any alerts", () => {
    dom.window.localStorage.setItem(LAST_VIEWED_KEY, "2026-08-17T00:00:00Z");
    dom.window.updateNotifBellFromAlerts([]);
    dom.window.renderDigestPanel({ generated_at: "2026-08-17T05:00:00Z", headline: "H", summary: "S", tips: [], market_tone: "neutre" });
    const badge = dom.window.document.getElementById("notif-bell-badge");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("1");
  });

  it("hides the badge when nothing is newer than last-viewed", () => {
    dom.window.localStorage.setItem(LAST_VIEWED_KEY, "2026-08-17T00:00:00Z");
    dom.window.updateNotifBellFromAlerts([{ triggered_at: "2020-01-01T00:00:00Z" }]);
    expect(dom.window.document.getElementById("notif-bell-badge").hidden).toBe(true);
  });

  it("on the very first call ever (no stored last-viewed), establishes a baseline instead of counting all history", () => {
    // Aucune entree dans localStorage : ne doit pas compter tout l'historique existant
    // d'un coup (sinon un nouvel utilisateur verrait "9+" des l'activation).
    dom.window.updateNotifBellFromAlerts([{ triggered_at: "2020-01-01T00:00:00Z" }]);
    expect(dom.window.document.getElementById("notif-bell-badge").hidden).toBe(true);
    expect(dom.window.localStorage.getItem(LAST_VIEWED_KEY)).toBeTruthy();
  });

  it("clearNotifBellBadge resets last-viewed to now and hides the badge", () => {
    dom.window.localStorage.setItem(LAST_VIEWED_KEY, "2026-08-17T00:00:00Z");
    dom.window.updateNotifBellFromAlerts([{ triggered_at: "2026-08-17T01:00:00Z" }]);
    expect(dom.window.document.getElementById("notif-bell-badge").hidden).toBe(false);

    dom.window.clearNotifBellBadge();
    expect(dom.window.document.getElementById("notif-bell-badge").hidden).toBe(true);
  });

  it("highlights key figures in the digest headline/summary/tips (the main long-form text block on Accueil)", () => {
    dom.window.renderDigestPanel({
      generated_at: "2026-08-17T05:00:00Z",
      headline: "BTC franchit les 50 % de dominance",
      summary: "Le marché a reculé de 8,2 % cette semaine, porté par une sortie de 12 775 dollars d'ETF.",
      tips: ["Surveiller le seuil de 9,9 % sur ETH"],
      market_tone: "neutre",
    });
    const html = dom.window.document.getElementById("digest-panel").innerHTML;
    expect(html).toContain('<mark class="hl-stat">50 %</mark>');
    expect(html).toContain('<mark class="hl-stat">8,2 %</mark>');
    expect(html).toContain('<mark class="hl-stat">12 775 dollars</mark>');
    expect(html).toContain('<mark class="hl-stat">9,9 %</mark>');
  });
});

// Régression du 19/08 : une fois un abonnement existant, il n'y avait AUCUN moyen d'en forcer
// un nouveau (le navigateur renvoie toujours le même abonnement tant que la permission reste
// accordée, même si la clé publique du site change entre-temps côté serveur) — l'utilisateur
// se retrouvait bloqué sur l'ancien code sans le savoir. Le bouton "Régénérer le code" corrige
// ça via unsubscribe() + un nouvel appel à subscribeToPush().
describe("notify.js — renderPushSection (bouton \"Régénérer le code\")", () => {
  let dom;
  const FIXTURE_HTML = `<!doctype html><html><body><div id="push-section"></div></body></html>`;

  function stubPushSupport(dom) {
    dom.window.PushManager = function () {};
    dom.window.navigator.serviceWorker = {};
  }

  function fakeSubscription(overrides = {}) {
    return {
      toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "x", auth: "y" } }),
      unsubscribe: async () => true,
      ...overrides,
    };
  }

  beforeEach(() => {
    dom = loadPage(["notify.js"], { html: FIXTURE_HTML });
    stubPushSupport(dom);
  });

  it("shows only the activation button (no reset button, no code) when there is no existing subscription", () => {
    dom.window.renderPushSection(null);
    const el = dom.window.document.getElementById("push-section");
    expect(el.querySelector("#push-enable-btn")).not.toBeNull();
    expect(el.querySelector("#push-reset-btn")).toBeNull();
  });

  it("shows the code, a copy button, and a reset button once a subscription exists", () => {
    dom.window.renderPushSection(fakeSubscription());
    const el = dom.window.document.getElementById("push-section");
    expect(el.querySelector("#push-sub-text").value).toContain("https://push.example/abc");
    expect(el.querySelector("#push-copy-btn")).not.toBeNull();
    expect(el.querySelector("#push-reset-btn")).not.toBeNull();
  });

  it("clicking 'Régénérer le code' unsubscribes the stale one and re-renders with a genuinely fresh subscription", async () => {
    let unsubscribeCalls = 0;
    const staleSub = fakeSubscription({ unsubscribe: async () => { unsubscribeCalls++; return true; } });
    const freshSub = fakeSubscription({
      toJSON: () => ({ endpoint: "https://push.example/FRESH", keys: { p256dh: "new-x", auth: "new-y" } }),
    });
    dom.window.subscribeToPush = async () => freshSub;

    dom.window.renderPushSection(staleSub);
    dom.window.document.getElementById("push-reset-btn").click();
    await new Promise((r) => setTimeout(r, 0));

    expect(unsubscribeCalls).toBe(1);
    const el = dom.window.document.getElementById("push-section");
    expect(el.querySelector("#push-sub-text").value).toContain("https://push.example/FRESH");
  });

  it("re-enables the reset button with its original label if regenerating fails, instead of leaving it stuck", async () => {
    const staleSub = fakeSubscription({ unsubscribe: async () => { throw new Error("offline"); } });
    dom.window.renderPushSection(staleSub);
    const resetBtn = dom.window.document.getElementById("push-reset-btn");
    resetBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(resetBtn.disabled).toBe(false);
    expect(resetBtn.textContent).toBe("Régénérer le code");
  });
});
