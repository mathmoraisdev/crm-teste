import type Redis from "ioredis";
import { redis } from "@/server/cache/redis";
import { tenantChannel } from "./bus";

type Listener = (data: string) => void;

/**
 * Multiplexador de SSE: UMA única conexão de subscribe por PROCESSO atende todas
 * as conexões/abas de todos os tenants. Sem isso, cada aba aberta abriria a sua
 * própria conexão no Redis (`redis.duplicate()` por request) e estouraria o
 * limite de conexões do provedor (ex.: free do Upstash) com poucos operadores.
 *
 * Estado no globalThis p/ sobreviver ao hot-reload do dev e garantir 1 instância.
 */
const g = globalThis as unknown as {
  tenantSub?: Redis | null;
  tenantListeners?: Map<string, Set<Listener>>;
};

function getListeners(): Map<string, Set<Listener>> {
  if (!g.tenantListeners) g.tenantListeners = new Map();
  return g.tenantListeners;
}

/** Conexão de subscribe única (lazy). No ioredis um cliente em modo subscribe não
 *  roda comandos normais, por isso duplicamos o cliente principal — UMA vez. */
function getSubscriber(): Redis | null {
  if (!redis) return null;
  if (g.tenantSub) return g.tenantSub;
  const sub = redis.duplicate();
  sub.on("error", (e: Error) => console.error("[redis-sub] erro:", e?.message ?? e));
  sub.on("message", (channel: string, message: string) => {
    const set = getListeners().get(channel);
    if (set) for (const fn of set) fn(message);
  });
  g.tenantSub = sub;
  return sub;
}

/**
 * Registra um listener SSE para a conta e devolve a função de cleanup. A 1ª
 * conexão de um tenant faz SUBSCRIBE no canal; a última a sair faz UNSUBSCRIBE.
 * Sem Redis devolve um no-op (a rota /api/stream já responde 503 antes).
 */
export function subscribeTenant(tenantUserId: string, onMessage: Listener): () => void {
  const sub = getSubscriber();
  if (!sub) return () => {};
  const channel = tenantChannel(tenantUserId);
  const listeners = getListeners();
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    void sub.subscribe(channel); // 1º listener deste tenant → assina o canal
  }
  set.add(onMessage);

  return () => {
    const s = listeners.get(channel);
    if (!s) return;
    s.delete(onMessage);
    if (s.size === 0) {
      listeners.delete(channel);
      void sub.unsubscribe(channel); // último a sair → desassina (poupa o canal)
    }
  };
}
