import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// scripts/cmc-snapshot.py : réponses BRUTES de CoinMarketCap -> data/crypto-global.json et
// data/cmc-favoris.json. Fixtures = extraits des vraies réponses du 10/10/2026 (BTC, CTSI, FLUX).
const SCRIPT = fileURLToPath(new URL("../scripts/cmc-snapshot.py", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/cmc-20261010", import.meta.url));

function run(setup) {
  const work = mkdtempSync(path.join(tmpdir(), "cmc-"));
  mkdirSync(path.join(work, "data"));
  const raw = path.join(work, "raw");
  cpSync(FIXTURES, raw, { recursive: true });
  if (setup) setup(raw);
  let status = 0;
  try {
    execFileSync("python3", [SCRIPT, raw], { cwd: work, stdio: "pipe" });
  } catch (e) {
    status = e.status;
  }
  const read = (f) => (existsSync(path.join(work, "data", f)) ? JSON.parse(readFileSync(path.join(work, "data", f), "utf-8")) : undefined);
  return { status, favoris: read("cmc-favoris.json"), global: read("crypto-global.json") };
}

describe("scripts/cmc-snapshot.py", () => {
  it("extrait cours, évolutions et analyse technique des vraies réponses", () => {
    const { status, favoris, global } = run();
    expect(status).toBe(0);
    expect(Object.keys(favoris.assets).sort()).toEqual(["BTC", "CTSI", "FLUX"]);
    const ctsi = favoris.assets.CTSI;
    expect(ctsi).toMatchObject({ cmc_id: 5444, rank: 519 });
    expect(ctsi.price_usd).toBeCloseTo(0.0353061, 6);
    expect(ctsi.change_pct["30d"]).toBeCloseTo(48.844, 2);
    expect(ctsi.change_pct["1y"]).toBeCloseTo(-26.563, 2);
    expect(ctsi.technical).toMatchObject({ rsi14: 71.02, sma200: 0.027135, macd_histogram: 0.00030654 });
    expect(favoris.assets.BTC.technical).toBeNull(); // pas de fichier d'analyse technique pour BTC
    expect(global.altcoin_season_index).toBe(64);
    expect(global.open_interest_usd).toBe(378070000000);
  });

  it("écarte une analyse technique recopiée sous le mauvais identifiant (MM7 incompatible avec le cours)", () => {
    const { favoris } = run((raw) => cpSync(path.join(raw, "ta-5444.json"), path.join(raw, "ta-1.json")));
    expect(favoris.assets.BTC.technical).toBeNull(); // MM7 de CTSI (0,03 $) face à un BTC à 82 990 $
    expect(favoris.assets.CTSI.technical).not.toBeNull();
  });

  it("met à null un RSI hors de 0-100 au lieu de le publier", () => {
    const { favoris } = run((raw) => {
      const ta = JSON.parse(readFileSync(path.join(raw, "ta-5444.json"), "utf-8"));
      ta.rsi.rsi14 = "712";
      writeFileSync(path.join(raw, "ta-5444.json"), JSON.stringify(ta));
    });
    expect(favoris.assets.CTSI.technical.rsi14).toBeNull();
    expect(favoris.assets.CTSI.technical.rsi7).toBe(77.53);
  });

  it("n'écrit rien quand aucune réponse n'est exploitable", () => {
    const { status, favoris, global } = run((raw) => {
      for (const f of ["quotes.json", "ta-5444.json", "global.json"]) writeFileSync(path.join(raw, f), "pas du json");
    });
    expect(status).toBe(1);
    expect(favoris).toBeUndefined();
    expect(global).toBeUndefined();
  });

  it("--ids donne les 15 identifiants vérifiés, dans un format prêt pour get_crypto_quotes_latest", () => {
    const out = execFileSync("python3", [SCRIPT, "--ids"], { encoding: "utf-8" }).split("\n");
    expect(out[0]).toBe("1,1027,3773,6719,22861,5444,14588,1975,21159,29210,3640,9104,3029,11841,7226");
    expect(out[1]).toContain("FLUX=3029");
  });
});
