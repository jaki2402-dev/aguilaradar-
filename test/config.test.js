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

describe("config.js — highlightKeyInfo", () => {
  const dom = loadPage(["config.js"]);
  const { highlightKeyInfo } = dom.window;

  it("returns an empty string for null/undefined/empty, like escapeHtml", () => {
    expect(highlightKeyInfo(null)).toBe("");
    expect(highlightKeyInfo(undefined)).toBe("");
    expect(highlightKeyInfo("")).toBe("");
  });

  it("leaves short plain text (no digits/scenario labels) identical to escapeHtml", () => {
    const text = "Momentum institutionnel fort.";
    expect(highlightKeyInfo(text)).toBe(dom.window.escapeHtml(text));
  });

  it("always escapes first — a script/img injection attempt is neutralized, never re-interpreted as HTML", () => {
    const html = highlightKeyInfo(`<img src=x onerror=alert(1)> 50% <script>alert(2)</script>`);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("wraps a plain percentage in a .hl-stat mark", () => {
    expect(highlightKeyInfo("part de marché de 50 % du secteur")).toBe(
      'part de marché de <mark class="hl-stat">50 %</mark> du secteur'
    );
  });

  it("wraps a French-decimal percentage whole, not split at the comma (regression: comma used to be treated as a thousands separator requiring 2-3 digits, cutting \"1,1 %\" into \"1,\" + \"1 %\")", () => {
    expect(highlightKeyInfo("soit environ 1,1 % de l'offre")).toBe(
      'soit environ <mark class="hl-stat">1,1 %</mark> de l&#39;offre'
    );
  });

  it("wraps a space-grouped thousands figure followed by a spelled-out currency word", () => {
    expect(highlightKeyInfo("environ 12 775 dollars par an")).toBe(
      'environ <mark class="hl-stat">12 775 dollars</mark> par an'
    );
  });

  it("wraps a currency-symbol-prefixed amount", () => {
    expect(highlightKeyInfo("prix cible de $150 000")).toBe('prix cible de <mark class="hl-stat">$150 000</mark>');
  });

  it("wraps Bull/Base/Bear scenario labels in colored spans, keyed by word", () => {
    const html = highlightKeyInfo("Bull : haussier. Base : neutre. Bear : baissier.");
    expect(html).toContain('<span class="hl-scenario hl-bull">Bull :</span>');
    expect(html).toContain('<span class="hl-scenario hl-base">Base :</span>');
    expect(html).toContain('<span class="hl-scenario hl-bear">Bear :</span>');
  });

  it("never uses <strong> for the scenario span (several site blocks style every <strong> as a block-level label)", () => {
    const html = highlightKeyInfo("Bull : haussier.");
    expect(html).not.toContain("<strong");
  });

  it("does not treat the ordinary lowercase French word 'base' as a scenario label (false-positive guard)", () => {
    const html = highlightKeyInfo("sur la base de plusieurs indicateurs techniques");
    expect(html).not.toContain("hl-scenario");
    expect(html).not.toContain("hl-base");
  });

  it("does not highlight a bare number with no percent/currency unit (dates, counts, versions stay plain)", () => {
    expect(highlightKeyInfo("15 positions suivies depuis 2024")).toBe(
      dom.window.escapeHtml("15 positions suivies depuis 2024")
    );
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

  it("every favori has a researched token utility description (assumed by detail.js utilitySignal)", () => {
    FAVORIS.forEach((f) => {
      expect(f.utility, `utility manquant pour ${f.ticker}`).toBeTruthy();
      expect(f.utility.length, `utility trop courte pour ${f.ticker} pour être une vraie explication`).toBeGreaterThan(30);
    });
  });

  it("THRESHOLDS.directionalMovePct is a single positive number reused everywhere (README invariant)", () => {
    expect(typeof THRESHOLDS.directionalMovePct).toBe("number");
    expect(THRESHOLDS.directionalMovePct).toBeGreaterThan(0);
  });
});

describe("config.js — glossaryTipHtml", () => {
  const dom = loadPage(["config.js"]);
  const { glossaryTipHtml } = dom.window;
  const GLOSSARY = getGlobal(dom, "GLOSSARY");

  it("returns an empty string for a term absent from GLOSSARY, never an invented definition", () => {
    expect(glossaryTipHtml("Terme qui n'existe pas")).toBe("");
  });

  it("renders an accessible, keyboard-focusable info bubble carrying the real GLOSSARY definition", () => {
    const html = glossaryTipHtml("RSI");
    expect(html).toContain('class="info-tip"');
    expect(html).toContain('tabindex="0"');
    const rsiDef = GLOSSARY.find((g) => g.term === "RSI").definition;
    // La définition contient des guillemets ("suracheté"/"survendu"), donc échappée en HTML
    // (&quot;) dans l'attribut data-tip — comparaison via la même fonction d'échappement.
    expect(html).toContain(dom.window.escapeHtml(rsiDef));
  });

  it("has the 3 macro terms added alongside the gold/Fed market-context fields", () => {
    ["Or (once, USD)", "Taux Fed (cible)", "Trésor US 10 ans"].forEach((term) => {
      expect(glossaryTipHtml(term), `glossaryTipHtml("${term}") ne doit pas être vide`).not.toBe("");
    });
  });
});
