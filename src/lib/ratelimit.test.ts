import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock controlável do cliente Redis (estado em `store` por chave).
const store = new Map<string, number>();
const incr = vi.fn(async (k: string) => {
  const n = (store.get(k) ?? 0) + 1;
  store.set(k, n);
  return n;
});
const expire = vi.fn(async () => 1);

vi.mock("@/server/cache/redis", () => ({
  get redis() {
    return mockRedis;
  },
}));

let mockRedis: { incr: typeof incr; expire: typeof expire } | null = { incr, expire };

describe("rateLimit", () => {
  beforeEach(() => {
    store.clear();
    incr.mockClear();
    expire.mockClear();
    mockRedis = { incr, expire };
  });

  it("incrementa e bloqueia ao exceder o limite", async () => {
    const { rateLimit } = await import("./ratelimit");
    // limite 2 na janela
    const a = await rateLimit("conta-1", 2, 60);
    const b = await rateLimit("conta-1", 2, 60);
    const c = await rateLimit("conta-1", 2, 60);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(false); // 3ª excede
    expect(c.remaining).toBe(0);
    expect(expire).toHaveBeenCalledTimes(1); // só na 1ª da janela
  });

  it("sem Redis, nunca bloqueia (degrada)", async () => {
    mockRedis = null;
    const { rateLimit } = await import("./ratelimit");
    const r = await rateLimit("conta-x", 1, 60);
    expect(r.ok).toBe(true);
  });
});
