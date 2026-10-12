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
    // Même jour : le point est rafraîchi (même date, remplacé dans main), jamais dupliqué.
    const fresh = { snapshots: [{ date: "2026-10-04", computed_at: "2026-10-04T20:00:00Z" }] };
    expect(buildSnapshot(positions, { bitcoin: 1, ethereum: 1 }, fresh, now).skip).toMatch(/moins de 2 h/);
    const old = { snapshots: [{ date: "2026-10-04", computed_at: "2026-10-04T09:00:00Z" }] };
    expect(buildSnapshot(positions, { bitcoin: 1, ethereum: 1 }, old, now).snapshot.date).toBe("2026-10-04");
  });
});

describe("point du jour mis à jour à chaque passage, jours passés intacts", () => {
  const prices = { bitcoin: 20000, ethereum: 1000 };
  it("date = jour UTC du relevé", () => {
    expect(snapshotDate(new Date("2026-10-12T22:38:00Z"))).toBe("2026-10-12");
    expect(snapshotDate(new Date("2026-10-13T01:43:00Z"))).toBe("2026-10-13");
  });

  it("cas réel du 11/10 : le passage de 22h01 rafraîchit le point de 10h11 au lieu de ne rien faire", () => {
    const history = { snapshots: [{ date: "2026-10-10" }, { date: "2026-10-11", computed_at: "2026-10-11T10:11:56Z" }] };
    const { snapshot } = buildSnapshot(positions, prices, history, new Date("2026-10-11T22:01:49Z"));
    expect(snapshot).toMatchObject({ date: "2026-10-11", computed_at: "2026-10-11T22:01:49Z" });
  });

  it("pas de réécriture si le point du jour a moins de 2 h ; jamais un jour antérieur au dernier", () => {
    const history = { snapshots: [{ date: "2026-10-12", computed_at: "2026-10-12T19:58:00Z" }] };
    expect(buildSnapshot(positions, prices, history, new Date("2026-10-12T21:00:00Z")).skip).toMatch(/moins de 2 h/);
    expect(buildSnapshot(positions, prices, { snapshots: [{ date: "2026-10-13" }] }, new Date("2026-10-12T21:00:00Z")).skip).toMatch(/postérieur/);
  });
});
