import { describe, it, expect } from "vitest";
import { loadPage } from "./helpers/loadPage.js";

describe("search.js — findLatestVerdict", () => {
  const dom = loadPage(["search.js"]);
  const { findLatestVerdict } = dom.window;

  it("picks the most recent verdict by issued_at, even when the input is not already sorted", () => {
    const verdicts = [
      { asset: "bitcoin", issued_at: "2026-08-01T00:00:00Z", verdict: "ATTENTE" },
      { asset: "bitcoin", issued_at: "2026-08-10T00:00:00Z", verdict: "VENTE" }, // le plus recent, pas le dernier du tableau
      { asset: "bitcoin", issued_at: "2026-08-05T00:00:00Z", verdict: "ACHAT" },
      { asset: "ethereum", issued_at: "2026-08-15T00:00:00Z", verdict: "ACHAT" },
    ];
    expect(findLatestVerdict(verdicts, "bitcoin").verdict).toBe("VENTE");
  });

  it("returns null when no verdict matches the given asset", () => {
    const verdicts = [{ asset: "bitcoin", issued_at: "2026-08-01T00:00:00Z" }];
    expect(findLatestVerdict(verdicts, "ethereum")).toBeNull();
  });

  it("is null-safe on a missing verdicts array", () => {
    expect(findLatestVerdict(null, "bitcoin")).toBeNull();
    expect(findLatestVerdict(undefined, "bitcoin")).toBeNull();
    expect(findLatestVerdict([], "bitcoin")).toBeNull();
  });
});

describe("search.js — findOpportunity", () => {
  const dom = loadPage(["search.js"]);
  const { findOpportunity } = dom.window;

  it("finds an opportunity by cgId", () => {
    const data = { opportunities: [{ cgId: "cardano", ticker: "ADA" }, { cgId: "solana", ticker: "SOL" }] };
    expect(findOpportunity(data, "solana").ticker).toBe("SOL");
  });

  it("returns null when nothing matches", () => {
    const data = { opportunities: [{ cgId: "cardano", ticker: "ADA" }] };
    expect(findOpportunity(data, "solana")).toBeNull();
  });

  it("is null-safe on missing opportunitiesData or a missing/empty opportunities array", () => {
    expect(findOpportunity(null, "cardano")).toBeNull();
    expect(findOpportunity({}, "cardano")).toBeNull();
    expect(findOpportunity({ opportunities: [] }, "cardano")).toBeNull();
  });
});
