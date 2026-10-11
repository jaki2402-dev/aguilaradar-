import { describe, it, expect } from "vitest";
import { buildSnapshot, snapshotDate } from "../scripts/portfolio-snapshot.mjs";

const now = new Date("2026-10-04T20:40:00Z");
const positions = [
  { cgId: "bitcoin", qty: 0.5, invested: 10000 },
  { cgId: "ethereum", qty: 2, invested: 3000 },
];

describe("scripts/portfolio-snapshot.mjs — buildSnapshot", () => {
  it("computes value, invested and P&L from real prices", () => {
    const { snapshot } = buildSnapshot(positions, { bitcoin: 20000, ethereum: 1000 }, { snapshots: [] }, now);
    expect(snapshot).toMatchObject({ date: "2026-10-04", total_value_eur: 12000, total_invested_eur: 13000, total_pnl_eur: -1000, total_pnl_pct: -7.69 });
  });

  it("skips the day rather than writing a partial total when one price is missing", () => {
    expect(buildSnapshot(positions, { bitcoin: 20000 }, { snapshots: [] }, now).skip).toMatch(/ethereum/);
  });

  it("skips a position whose quantity is pending", () => {
    const pending = [...positions, { cgId: "celestia", qty: null, invested: 100, pending: true }];
    expect(buildSnapshot(pending, { bitcoin: 1, ethereum: 1, celestia: 1 }, { snapshots: [] }, now).skip).toMatch(/celestia/);
  });

  it("never writes two snapshots for the same day", () => {
    expect(buildSnapshot(positions, { bitcoin: 1, ethereum: 1 }, { snapshots: [{ date: "2026-10-04" }] }, now).skip).toMatch(/déjà/);
  });
});

describe("date du point : un passage retardé après minuit compte pour la veille", () => {
  it("cas réels du 10 et 11/10/2026", () => {
    expect(snapshotDate(new Date("2026-10-10T00:17:36Z"))).toBe("2026-10-09"); // tâche du 09 au soir, lancée à 00h17
    expect(snapshotDate(new Date("2026-10-10T23:47:55Z"))).toBe("2026-10-10"); // tâche du 10 au soir
    expect(snapshotDate(new Date("2026-10-11T10:10:00Z"))).toBe("2026-10-11");
    expect(snapshotDate(new Date("2026-10-11T05:59:00Z"))).toBe("2026-10-10");
    expect(snapshotDate(new Date("2026-10-11T06:00:00Z"))).toBe("2026-10-11");
  });

  it("le passage du soir ne trouve plus sa date « volée » par le passage retardé de la veille", () => {
    const history = { snapshots: [{ date: snapshotDate(new Date("2026-10-10T00:17:36Z")) }] }; // 09/10
    const { snapshot } = buildSnapshot(positions, { bitcoin: 20000, ethereum: 1000 }, history, new Date("2026-10-10T23:47:55Z"));
    expect(snapshot.date).toBe("2026-10-10");
  });
});
