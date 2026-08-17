// Contrats de données : data/*.json est écrit par des routines Cowork qui tournent HORS de
// ce dépôt (voir README) et committent directement — ce dépôt n'a aucun contrôle sur ce qui
// y atterrit. Ces tests visent la FORME (types, champs requis, valeurs autorisées), jamais
// le contenu du jour, pour rester valables au fil des cycles tout en attrapant une vraie
// régression de schéma (champ renommé, JSON invalide, valeur hors énumération).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { loadPage, getGlobal } from "./helpers/loadPage.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const VALID_VERDICTS = ["ACHAT", "ATTENTE", "VENTE"];

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(ROOT, relPath), "utf8"));
}

function isIsoDateString(s) {
  return typeof s === "string" && !Number.isNaN(new Date(s).getTime());
}

describe("data/*.json — tout le monde est au moins du JSON valide", () => {
  const files = [
    "data/verdicts.json",
    "data/opportunities.json",
    "data/engine-history.json",
    "data/alerts.json",
    "data/control-group.json",
    "data/market-context.json",
    "data/favoris-context.json",
    "data/health-log.json",
    "data/digest.json",
    "data/news.json",
  ];
  it.each(files)("%s parse sans erreur", (relPath) => {
    expect(() => readJson(relPath)).not.toThrow();
  });
});

describe("data/verdicts.json", () => {
  const verdicts = readJson("data/verdicts.json");

  it("is an array", () => {
    expect(Array.isArray(verdicts)).toBe(true);
  });

  it("every entry has the fields the renderers (journal, moteur, assistant) all assume exist", () => {
    verdicts.forEach((v) => {
      expect(typeof v.id).toBe("string");
      expect(typeof v.asset).toBe("string");
      expect(typeof v.ticker).toBe("string");
      expect(VALID_VERDICTS).toContain(v.verdict);
      expect(typeof v.horizon_days).toBe("number");
      expect(typeof v.confidence_pct).toBe("number");
      expect(isIsoDateString(v.issued_at)).toBe(true);
      expect(["pending", "resolved"]).toContain(v.status);
      expect(v.outcome).toBeTypeOf("object");
    });
  });

  it("a resolved verdict always carries a resolved_at and a boolean verdict_correct — never half-filled (per README: never invent a premature outcome)", () => {
    verdicts
      .filter((v) => v.status === "resolved")
      .forEach((v) => {
        expect(isIsoDateString(v.outcome.resolved_at)).toBe(true);
        expect(typeof v.outcome.verdict_correct).toBe("boolean");
      });
  });

  it("a pending verdict never has an outcome filled in (no invented premature result)", () => {
    verdicts
      .filter((v) => v.status === "pending")
      .forEach((v) => {
        expect(v.outcome.resolved_at).toBeNull();
        expect(v.outcome.verdict_correct).toBeNull();
      });
  });
});

describe("data/opportunities.json", () => {
  const data = readJson("data/opportunities.json");

  it("has the expected top-level shape", () => {
    expect(Array.isArray(data.opportunities)).toBe(true);
    expect(isIsoDateString(data.last_scan_at)).toBe(true);
  });

  it("every opportunity has the fields cards.js/engine.js/detail.js all read", () => {
    data.opportunities.forEach((o) => {
      expect(typeof o.ticker).toBe("string");
      expect(typeof o.name).toBe("string");
      expect(typeof o.cgId).toBe("string");
      expect(typeof o.price_eur).toBe("number");
    });
  });

  it("when horizons are present, only the 5 known keys are used, each with a recognized status", () => {
    const knownKeys = new Set(["j1", "j3", "j7", "j14", "m6"]);
    data.opportunities.forEach((o) => {
      if (!o.horizons) return;
      Object.entries(o.horizons).forEach(([key, h]) => {
        expect(knownKeys.has(key)).toBe(true);
        expect(["pending", "resolved"]).toContain(h.status);
      });
    });
  });
});

describe("data/engine-history.json", () => {
  const data = readJson("data/engine-history.json");

  it("has global_stats and routine_health blocks with the fields app.js/engine.js depend on", () => {
    expect(data.global_stats).toBeTypeOf("object");
    expect(typeof data.global_stats.total_verdicts_issued).toBe("number");
    expect(typeof data.global_stats.total_verdicts_resolved).toBe("number");
    expect(data.routine_health).toBeTypeOf("object");
    expect(isIsoDateString(data.routine_health.last_success_at)).toBe(true);
  });
});

describe("data/alerts.json", () => {
  const alerts = readJson("data/alerts.json");

  it("is an array where every entry has the fields renderNotifications/checkForNewOpportunities read", () => {
    expect(Array.isArray(alerts)).toBe(true);
    alerts.forEach((a) => {
      expect(typeof a.id).toBe("string");
      expect(typeof a.type).toBe("string");
      expect(isIsoDateString(a.triggered_at)).toBe(true);
      expect(typeof a.message).toBe("string");
    });
  });
});

describe("data/control-group.json", () => {
  const cg = readJson("data/control-group.json");

  it("sample_size matches the actual items count (used as a trust signal by renderControlGroupComparison)", () => {
    expect(Array.isArray(cg.items)).toBe(true);
    expect(cg.sample_size).toBe(cg.items.length);
  });
});

describe("data/favoris-context.json — cohérence avec les 15 favoris de config.js", () => {
  it("every ticker key is a real, currently-tracked favori (no stale/renamed ticker silently ignored)", () => {
    const favContext = readJson("data/favoris-context.json");
    const dom = loadPage(["config.js"]);
    const FAVORIS = getGlobal(dom, "FAVORIS");
    const knownTickers = new Set(FAVORIS.map((f) => f.ticker));
    Object.keys(favContext.assets || {}).forEach((ticker) => {
      expect(knownTickers.has(ticker), `ticker inconnu dans favoris-context.json: ${ticker}`).toBe(true);
    });
  });
});

describe("data/news.json — les URLs passent le même filtre que le rendu réel (safeUrl)", () => {
  it("every news item URL is accepted by safeUrl (http/https only) — the exact guard news-item rendering relies on", () => {
    const news = readJson("data/news.json");
    const dom = loadPage(["config.js"], { url: "https://aguilaradar.test/" });
    const { safeUrl } = dom.window;
    (news.items || []).forEach((item) => {
      expect(safeUrl(item.url), `URL rejetée par safeUrl: ${item.url}`).not.toBeNull();
    });
  });
});

describe("data/digest.json / data/health-log.json — formes minimales", () => {
  it("digest.json has the fields notify.js/assistant.js read when present", () => {
    const digest = readJson("data/digest.json");
    if (!digest.generated_at) return; // pas encore généré : forme vide acceptée
    expect(isIsoDateString(digest.generated_at)).toBe(true);
    expect(typeof digest.headline).toBe("string");
    expect(typeof digest.summary).toBe("string");
    expect(Array.isArray(digest.tips)).toBe(true);
  });

  it("health-log.json checks[] entries carry files_ok/files_broken arrays used to derive the OK/problem badge", () => {
    const healthLog = readJson("data/health-log.json");
    expect(Array.isArray(healthLog.checks)).toBe(true);
    healthLog.checks.forEach((c) => {
      expect(isIsoDateString(c.checked_at)).toBe(true);
      expect(Array.isArray(c.files_ok)).toBe(true);
      expect(Array.isArray(c.files_broken)).toBe(true);
    });
  });
});
