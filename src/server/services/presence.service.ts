import { redis } from "@/server/cache/redis";
import { publishTenantEvent } from "@/server/events/bus";

/**
 * Presença efêmera "quem está vendo esta conversa" (anti-colisão do inbox).
 *
 * Guardada só no Redis (sem persistência): cada operador manda um heartbeat ao
 * abrir/ficar numa conversa e a chave expira sozinha se ele parar. Sem Redis
 * (dev/local sem REDIS_URL) tudo degrada para "ninguém aparece" — informativo,
 * nunca bloqueia responder ([[crm-inbox-db-push-pending]]).
 *
 * Modelo: um ZSET por lead (`presence:z:{leadId}`) com member=userId e
 * score=expiraEm(ms). Assim cada operador expira individualmente (ZREMRANGEBYSCORE
 * limpa os vencidos) sem varrer o keyspace (nada de KEYS). Os nomes ficam num
 * hash pequeno à parte (`presence:name`) para exibir sem ir ao banco.
 */

export interface Viewer {
  userId: string;
  name: string;
}

const DEFAULT_TTL_MS = 30_000;

function zkey(leadId: string): string {
  return `presence:z:${leadId}`;
}
const NAME_KEY = "presence:name";

/**
 * Registra/renova a presença de um operador numa conversa. Best-effort: falha de
 * Redis nunca quebra o fluxo. Publica um evento p/ as outras abas atualizarem.
 */
export async function heartbeat(args: {
  tenantUserId: string;
  leadId: string;
  userId: string;
  name: string;
  ttlMs?: number;
  now?: number;
}): Promise<void> {
  if (!redis) return;
  const ttl = args.ttlMs ?? DEFAULT_TTL_MS;
  const now = args.now ?? Date.now();
  const key = zkey(args.leadId);
  try {
    await redis
      .multi()
      .zadd(key, now + ttl, args.userId)
      .zremrangebyscore(key, 0, now) // purga vencidos
      .hset(NAME_KEY, args.userId, args.name)
      .pexpire(key, ttl * 2) // a própria chave some se ninguém renova
      .exec();
    await publishTenantEvent(args.tenantUserId, { type: "presence:changed", leadId: args.leadId });
  } catch {
    // sem realtime neste tick; a UI só não mostra presença
  }
}

/** Remove a presença do operador (ao fechar/sair da conversa). Best-effort. */
export async function stopViewing(args: {
  tenantUserId: string;
  leadId: string;
  userId: string;
}): Promise<void> {
  if (!redis) return;
  try {
    await redis.zrem(zkey(args.leadId), args.userId);
    await publishTenantEvent(args.tenantUserId, { type: "presence:changed", leadId: args.leadId });
  } catch {
    // ignora
  }
}

/**
 * Quem está vendo a conversa agora (exceto os expirados). Purga os vencidos antes
 * de ler. `excludeUserId` tira o próprio operador da lista (a UI mostra "os
 * outros"). Sem Redis → lista vazia.
 */
export async function whoIsViewing(
  leadId: string,
  opts: { excludeUserId?: string; now?: number } = {},
): Promise<Viewer[]> {
  if (!redis) return [];
  const now = opts.now ?? Date.now();
  const key = zkey(leadId);
  try {
    await redis.zremrangebyscore(key, 0, now);
    const ids = await redis.zrange(key, 0, -1);
    const filtered = ids.filter((id) => id !== opts.excludeUserId);
    if (filtered.length === 0) return [];
    const names = await redis.hmget(NAME_KEY, ...filtered);
    return filtered.map((userId, i) => ({ userId, name: names[i] ?? "Operador" }));
  } catch {
    return [];
  }
}

/**
 * Presença de vários leads de uma vez (p/ a lista do inbox). Uma pipeline: purga
 * + lê os membros de cada lead num só round-trip, depois resolve os nomes em um
 * único HMGET. Sem Redis → mapa vazio. Best-effort (nunca lança).
 */
export async function whoIsViewingMany(
  leadIds: string[],
  opts: { excludeUserId?: string; now?: number } = {},
): Promise<Record<string, Viewer[]>> {
  const empty: Record<string, Viewer[]> = {};
  if (!redis || leadIds.length === 0) return empty;
  const now = opts.now ?? Date.now();
  try {
    const pipe = redis.pipeline();
    for (const id of leadIds) {
      pipe.zremrangebyscore(zkey(id), 0, now);
      pipe.zrange(zkey(id), 0, -1);
    }
    const res = await pipe.exec(); // [[err, purgeRes], [err, idsRes], ...] por lead
    if (!res) return empty;

    // Junta os ids por lead (a 2ª resposta de cada par é o zrange).
    const byLead: Record<string, string[]> = {};
    const allIds = new Set<string>();
    leadIds.forEach((leadId, i) => {
      const zrangeRes = res[i * 2 + 1]?.[1] as string[] | undefined;
      const ids = (zrangeRes ?? []).filter((u) => u !== opts.excludeUserId);
      byLead[leadId] = ids;
      ids.forEach((u) => allIds.add(u));
    });

    // Resolve todos os nomes num HMGET só.
    const idList = [...allIds];
    const nameMap = new Map<string, string>();
    if (idList.length > 0) {
      const names = await redis.hmget(NAME_KEY, ...idList);
      idList.forEach((u, i) => nameMap.set(u, names[i] ?? "Operador"));
    }

    const out: Record<string, Viewer[]> = {};
    for (const [leadId, ids] of Object.entries(byLead)) {
      if (ids.length > 0) out[leadId] = ids.map((u) => ({ userId: u, name: nameMap.get(u) ?? "Operador" }));
    }
    return out;
  } catch {
    return empty;
  }
}
