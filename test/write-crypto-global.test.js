import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Script lancé par la routine coinmarketcap-quotidien (docs/coinmarketcap.md) : convertit les valeurs
// affichées par CoinMarketCap ("378.07 B", "-12.34%") en nombres, jamais la routine elle-même.
const SCRIPT = fileURLToPath(new URL("../scripts/write-crypto-global.py", import.meta.url));

function run(args) {
  const dir = mkdtempSync(path.join(tmpdir(), "cg-"));
  mkdirSync(path.join(dir, "data"));
  const file = path.join(dir, "data/crypto-global.json");
  let error = null;
  try {
    execFileSync("python3", [SCRIPT, ...args], { cwd: dir, stdio: "pipe" });
  } catch (e) {
    error = e;
  }
  return { data: existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : undefined, error };
}

describe("scripts/write-crypto-global.py", () => {
  it("convertit les valeurs réelles du 10/10/2026 dans data/crypto-global.json", () => {
    const { data, error } = run(["64", "378.07 B", "-12.34%", "+0.0042474%", "3.67 M", "108.82 B", "14.6 B"]);
    expect(error).toBeNull();
    expect(data).toMatchObject({
      altcoin_season_index: 64,
      open_interest_usd: 378070000000,
      open_interest_change_7d_pct: -12.34,
      funding_rate_avg_pct: 0.0042474,
      btc_liquidations_24h_usd: 3670000,
      btc_etf_aum_usd: 108820000000,
      eth_etf_aum_usd: 14600000000,
    });
    expect(data.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("une valeur illisible devient null, jamais un chiffre deviné", () => {
    const { data } = run(["abc", "1,234.5 M", "n/a", "", "", "", ""]);
    expect(data.altcoin_season_index).toBeNull();
    expect(data.open_interest_usd).toBe(1234500000);
    expect(data.open_interest_change_7d_pct).toBeNull();
  });

  it("n'écrit rien si aucune valeur n'est exploitable", () => {
    const { data, error } = run(["", "", "", "", "", "", ""]);
    expect(error).not.toBeNull();
    expect(data).toBeUndefined(); // aucun fichier créé
  });
});
