import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake Redis mínimo: um ZSET (Map member→score) por chave + um HASH global.
// Suporta só os comandos que presence.service usa, incluindo multi()/exec().
function makeFakeRedis() {
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, string>>();
  const z = (k: string) => zsets.get(k) ?? (zsets.set(k, new Map()), zsets.get(k)!);
  const h = (k: string) => hashes.get(k) ?? (hashes.set(k, new Map()), hashes.get(k)!);

  const ops = {
    zadd(key: string, score: number, member: string) {
      z(key).set(member, score);
    },
    zremrangebyscore(key: string, min: number, max: number) {
      for (const [m, s] of z(key)) if (s >= min && s <= max) z(key).delete(m);
    },
    hset(key: string, field: string, value: string) {
      h(key).set(field, value);
    },
    pexpire(_key: string, _ms: number) {
      /* no-op no fake */
    },
    zrem(key: string, member: string) {
      z(key).delete(member);
    },
    zrange(key: string, start: number, stop: number) {
      const sorted = [...z(key).entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
      const end = stop === -1 ? sorted.length : stop + 1;
      return sorted.slice(start, end);
    },
    hmget(key: string, ...fields: string[]) {
      return fields.map((f) => h(key).get(f) ?? null);
    },
  };

  const client: any = {
    zrem: async (k: string, m: string) => ops.zrem(k, m),
    zremrangebyscore: async (k: string, a: number, b: number) => ops.zremrangebyscore(k, a, b),
    zrange: async (k: string, a: number, b: number) => ops.zrange(k, a, b),
    hmget: async (k: string, ...f: string[]) => ops.hmget(k, ...f),
    multi() {
      const queued: Array<() => void> = [];
      const chain: any = {
        zadd: (k: string, s: number, m: string) => (queued.push(() => ops.zadd(k, s, m)), chain),
        zremrangebyscore: (k: string, a: number, b: number) => (queued.push(() => ops.zremrangebyscore(k, a, b)), chain),
        hset: (k: string, f: string, v: string) => (queued.push(() => ops.hset(k, f, v)), chain),
        pexpire: (k: string, ms: number) => (queued.push(() => ops.pexpire(k, ms)), chain),
        exec: async () => {
          queued.forEach((fn) => fn());
          return [];
        },
      };
      return chain;
    },
  };
  return client;
}

const fake = makeFakeRedis();
vi.mock("@/server/cache/redis", () => ({ redis: fake }));
vi.mock("@/server/events/bus", () => ({ publishTenantEvent: vi.fn() }));

describe("presence.service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("heartbeat registra quem está vendo; whoIsViewing lista os ativos", async () => {
    const { heartbeat, whoIsViewing } = await import("./presence.service");
    const now = 1_000_000;
    await heartbeat({ tenantUserId: "t", leadId: "L", userId: "ana", name: "Ana", now });
    await heartbeat({ tenantUserId: "t", leadId: "L", userId: "beto", name: "Beto", now });
    const viewers = await whoIsViewing("L", { now: now + 1000 });
    expect(viewers.map((v) => v.userId).sort()).toEqual(["ana", "beto"]);
    expect(viewers.find((v) => v.userId === "ana")?.name).toBe("Ana");
  });

  it("excludeUserId tira o próprio operador da lista", async () => {
    const { heartbeat, whoIsViewing } = await import("./presence.service");
    const now = 2_000_000;
    await heartbeat({ tenantUserId: "t", leadId: "L2", userId: "ana", name: "Ana", now });
    await heartbeat({ tenantUserId: "t", leadId: "L2", userId: "beto", name: "Beto", now });
    const viewers = await whoIsViewing("L2", { excludeUserId: "ana", now: now + 1000 });
    expect(viewers.map((v) => v.userId)).toEqual(["beto"]);
  });

  it("presença expira após o TTL (score vencido some da leitura)", async () => {
    const { heartbeat, whoIsViewing } = await import("./presence.service");
    const now = 3_000_000;
    await heartbeat({ tenantUserId: "t", leadId: "L3", userId: "ana", name: "Ana", ttlMs: 30_000, now });
    // 31s depois, sem novo heartbeat → expirou
    const viewers = await whoIsViewing("L3", { now: now + 31_000 });
    expect(viewers).toEqual([]);
  });

  it("stopViewing remove a presença imediatamente", async () => {
    const { heartbeat, whoIsViewing, stopViewing } = await import("./presence.service");
    const now = 4_000_000;
    await heartbeat({ tenantUserId: "t", leadId: "L4", userId: "ana", name: "Ana", now });
    await stopViewing({ tenantUserId: "t", leadId: "L4", userId: "ana" });
    expect(await whoIsViewing("L4", { now: now + 1000 })).toEqual([]);
  });
});
