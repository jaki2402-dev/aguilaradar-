import { describe, it, expect } from "vitest";
import { loadPage, getGlobal } from "./helpers/loadPage.js";

describe("config.js — escapeHtml", () => {
  const dom = loadPage(["config.js"]);
  const { escapeHtml } = dom.window;

  it("returns an empty string for null/undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Bitcoin")).toBe("Bitcoin");
  });

  it("escapes each special character individually", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("escapes a realistic mixed string (news title / AI summary shape)", () => {
    const input = `<a href="x">O'Reilly & Sons</a>`;
    const expected = `&lt;a href=&quot;x&quot;&gt;O&#39;Reilly &amp; Sons&lt;/a&gt;`;
    expect(escapeHtml(input)).toBe(expected);
  });

  it("coerces non-string values via String()", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(0)).toBe("0");
  });
});

describe("config.js — safeUrl", () => {
  const dom = loadPage(["config.js"], { url: "https://aguilaradar.test/" });
  const { safeUrl } = dom.window;

  it("accepts an absolute https URL unchanged", () => {
    expect(safeUrl("https://example.com/page?a=1")).toBe("https://example.com/page?a=1");
  });

  it("accepts an absolute http URL", () => {
    expect(safeUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  it("rejects javascript: URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects data: URLs", () => {
    expect(safeUrl("data:text/html,hi")).toBeNull();
  });

  it("rejects non-http(s) schemes like ftp:", () => {
    expect(safeUrl("ftp://example.com/x")).toBeNull();
  });

  it("resolves a relative URL against window.location.href", () => {
    expect(safeUrl("data/verdicts.json")).toBe("https://aguilaradar.test/data/verdicts.json");
  });

  it("returns null for a genuinely malformed URL (caught exception path)", () => {
    // Hôte IPv6 jamais fermé — vérifié manuellement : `new URL(...)` lève bien
    // "Invalid URL" pour ce cas, ce n'est pas juste résolu comme un chemin relatif.
    expect(safeUrl("http://[invalid")).toBeNull();
  });

  it("returns null for non-string / empty / nullish input", () => {
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});

describe("config.js — data contracts", () => {
  const dom = loadPage(["config.js"]);
  // FAVORIS/SECTORS/SECTOR_COLORS/THRESHOLDS sont déclarés en `const` dans config.js :
  // jamais exposés comme propriétés de window (même en vrai navigateur), d'où getGlobal.
  const FAVORIS = getGlobal(dom, "FAVORIS");
  const SECTORS = getGlobal(dom, "SECTORS");
  const SECTOR_COLORS = getGlobal(dom, "SECTOR_COLORS");
  const THRESHOLDS = getGlobal(dom, "THRESHOLDS");

  it("has exactly 15 favoris, per the README", () => {
    expect(FAVORIS).toHaveLength(15);
  });

  it("every favori has a unique, non-empty cgId and ticker", () => {
    const cgIds = FAVORIS.map((f) => f.cgId);
    const tickers = FAVORIS.map((f) => f.ticker);
    expect(new Set(cgIds).size).toBe(FAVORIS.length);
    expect(new Set(tickers).size).toBe(FAVORIS.length);
    FAVORIS.forEach((f) => {
      expect(f.cgId).toBeTruthy();
      expect(f.ticker).toBeTruthy();
      expect(f.tvSymbol).toBeTruthy();
    });
  });

  it("every favori's cgId has a matching SECTORS entry (assumed implicitly by insights.js renderSectorBreakdown)", () => {
    FAVORIS.forEach((f) => {
      expect(SECTORS[f.cgId], `SECTORS['${f.cgId}'] (${f.ticker}) manquant`).toBeTruthy();
    });
  });

  it("every favori's cgId has a matching SECTOR_COLORS entry (assumed implicitly by app.js renderFavorisGrid)", () => {
    FAVORIS.forEach((f) => {
      expect(SECTOR_COLORS[f.cgId], `SECTOR_COLORS['${f.cgId}'] (${f.ticker}) manquant`).toBeTruthy();
    });
  });

  it("THRESHOLDS.directionalMovePct is a single positive number reused everywhere (README invariant)", () => {
    expect(typeof THRESHOLDS.directionalMovePct).toBe("number");
    expect(THRESHOLDS.directionalMovePct).toBeGreaterThan(0);
  });
});
