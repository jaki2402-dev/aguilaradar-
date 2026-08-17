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
});
