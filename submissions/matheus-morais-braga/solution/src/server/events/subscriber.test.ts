import { describe, it, expect, vi, beforeEach } from "vitest";

// Subscriber Redis falso: captura os handlers e conta subscribe/unsubscribe.
const handlers: Record<string, (...a: any[]) => void> = {};
const sub = {
  on: vi.fn((evt: string, cb: (...a: any[]) => void) => {
    handlers[evt] = cb;
  }),
  subscribe: vi.fn(async () => {}),
  unsubscribe: vi.fn(async () => {}),
};

vi.mock("@/server/cache/redis", () => ({
  redis: { duplicate: () => sub },
}));

describe("subscribeTenant — multiplexação de SSE", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as any).tenantSub;
    delete (globalThis as any).tenantListeners;
    sub.on.mockClear();
    sub.subscribe.mockClear();
    sub.unsubscribe.mockClear();
    for (const k of Object.keys(handlers)) delete handlers[k];
  });

  it("assina o canal no 1º listener, despacha a mensagem e desassina no último", async () => {
    const { subscribeTenant } = await import("./subscriber");
    const got: string[] = [];
    const off = subscribeTenant("user-1", (m) => got.push(m));

    // 1º listener → 1 subscribe no canal do tenant
    expect(sub.subscribe).toHaveBeenCalledWith("tenant:user-1");
    expect(sub.subscribe).toHaveBeenCalledTimes(1);

    // mensagem publicada no canal chega ao listener
    handlers.message("tenant:user-1", "ping");
    expect(got).toEqual(["ping"]);

    // último a sair → unsubscribe
    off();
    expect(sub.unsubscribe).toHaveBeenCalledWith("tenant:user-1");
  });

  it("uma conexão compartilhada: 2 listeners do mesmo tenant = 1 subscribe", async () => {
    const { subscribeTenant } = await import("./subscriber");
    const off1 = subscribeTenant("user-1", () => {});
    const off2 = subscribeTenant("user-1", () => {});

    expect(sub.subscribe).toHaveBeenCalledTimes(1); // assina só na 1ª

    off1();
    expect(sub.unsubscribe).not.toHaveBeenCalled(); // ainda há 1 ouvindo
    off2();
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1); // só desassina no último
  });
});
