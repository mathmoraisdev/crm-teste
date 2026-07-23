import { describe, it, expect } from "vitest";
import { isReclaimable } from "./reaper";

const base = {
  status: "SENDING" as const,
  claimedAt: new Date("2026-06-19T12:00:00Z"),
};
const LEASE = 120_000; // 2 min

describe("isReclaimable", () => {
  it("recupera SENDING parado além do lease", () => {
    const now = new Date("2026-06-19T12:03:00Z"); // 3 min depois
    expect(isReclaimable(base, now, LEASE)).toBe(true);
  });

  it("NÃO recupera SENDING dentro do lease", () => {
    const now = new Date("2026-06-19T12:01:00Z"); // 1 min depois
    expect(isReclaimable(base, now, LEASE)).toBe(false);
  });

  it("NÃO recupera job que não está em SENDING", () => {
    const now = new Date("2026-06-19T13:00:00Z");
    expect(isReclaimable({ ...base, status: "SENT" }, now, LEASE)).toBe(false);
  });

  it("recupera SENDING sem claimedAt (legado/inconsistente)", () => {
    const now = new Date("2026-06-19T13:00:00Z");
    expect(isReclaimable({ ...base, claimedAt: null }, now, LEASE)).toBe(true);
  });
});
