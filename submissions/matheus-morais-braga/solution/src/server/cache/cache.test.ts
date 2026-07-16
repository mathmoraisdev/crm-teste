import { describe, it, expect, vi, beforeEach } from "vitest";

describe("cache helpers — fallback sem Redis", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.REDIS_URL;
  });

  it("sem REDIS_URL, cached() chama a fonte", async () => {
    const { cached } = await import("./cache");
    const fn = vi.fn().mockResolvedValue(42);
    expect(await cached("k", 60, fn)).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("sem REDIS_URL, invalidate() é no-op (não lança)", async () => {
    const { invalidate } = await import("./cache");
    await expect(invalidate("a", "b")).resolves.toBeUndefined();
  });
});
