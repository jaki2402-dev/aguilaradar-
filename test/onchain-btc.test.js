import { describe, it, expect } from "vitest";
import { chartByDay, tvlByDay, buildBtcSnapshot } from "../scripts/onchain-btc.mjs";

const D = (iso) => Date.parse(iso) / 1000;
const chart = (pts) => ({ status: "ok", values: pts.map(([iso, y]) => ({ x: D(iso), y })) });

describe("scripts/onchain-btc.mjs — instantané on-chain du bitcoin", () => {
  const tx = chartByDay(chart([["2026-10-09T00:00:00Z", 601234], ["2026-10-10T00:00:00Z", 588765], ["2026-10-11T00:00:00Z", 120000]]));
  const addr = chartByDay(chart([["2026-10-09T00:00:00Z", 551000], ["2026-10-10T00:00:00Z", 547321]]));
  const tvl = tvlByDay([{ date: D("2026-10-10T00:00:00Z"), tvl: 4.61e9 }]);
  const now = new Date("2026-10-11T10:40:00Z");

  it("dernier jour COMPLET où transactions et adresses sont connues (jamais le jour en cours)", () => {
    const { snapshot } = buildBtcSnapshot(tx, addr, tvl, { assets: { bitcoin: { snapshots: [{ date: "2026-10-04" }] } } }, now);
    expect(snapshot).toMatchObject({ date: "2026-10-10", tx_per_day: 588765, active_addresses: 547321, tvl_usd: 4610000000, computed_at: "2026-10-11T10:40:00Z" });
  });

  it("jamais deux fois le même jour, jamais un jour antérieur au dernier enregistré", () => {
    expect(buildBtcSnapshot(tx, addr, tvl, { assets: { bitcoin: { snapshots: [{ date: "2026-10-10" }] } } }, now).skip).toMatch(/déjà/);
    expect(buildBtcSnapshot(tx, addr, tvl, { assets: { bitcoin: { snapshots: [{ date: "2026-10-12" }] } } }, now).skip).toMatch(/plus récent/);
  });

  it("TVL absente ce jour-là : instantané sans TVL (null), pas inventée", () => {
    const { snapshot } = buildBtcSnapshot(tx, addr, new Map(), { assets: {} }, now);
    expect(snapshot.tvl_usd).toBeNull();
    expect(snapshot.source.tvl_usd).toMatch(/non disponible/);
  });

  it("données incomplètes : rien plutôt qu'un point partiel", () => {
    expect(buildBtcSnapshot(tx, new Map(), tvl, { assets: {} }, now).skip).toMatch(/aucun jour complet/);
  });
});
