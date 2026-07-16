// src/lib/billing.ts

/** Override manual do admin sobre o prazo automático (modelo híbrido). */
export type BillingOverride = "AUTO" | "ACTIVE" | "SUSPENDED";

/** Campos de billing que decidem se a conta funciona. */
export interface AccountAccess {
  billingOverride: BillingOverride;
  accessUntil: Date | null;
}

/**
 * True se a conta está ativa AGORA. Híbrido:
 *  - SUSPENDED: cala sempre (mesmo com data futura) — kill switch manual.
 *  - ACTIVE: libera sempre (mesmo vencida) — cortesia/grace manual.
 *  - AUTO: segue a data — ativo só enquanto `accessUntil` está no futuro.
 * Sem data + AUTO = suspenso (conta nunca liberada). Em tempo real, sem cron.
 */
export function accountActive(acc: AccountAccess, now: Date = new Date()): boolean {
  if (acc.billingOverride === "SUSPENDED") return false;
  if (acc.billingOverride === "ACTIVE") return true;
  return acc.accessUntil != null && acc.accessUntil.getTime() > now.getTime();
}

const DAY_MS = 1000 * 60 * 60 * 24;

/** Dias inteiros restantes (arredonda p/ cima). Vencido = 0; sem data = null. */
export function daysRemaining(accessUntil: Date | null, now: Date = new Date()): number | null {
  if (accessUntil == null) return null;
  const diff = accessUntil.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / DAY_MS);
}

/** Soma `days` a uma base, partindo de `max(base, now)` (não encurta prazo vigente). */
export function addDays(base: Date | null, days: number, now: Date = new Date()): Date {
  const start = base && base.getTime() > now.getTime() ? base : now;
  return new Date(start.getTime() + days * DAY_MS);
}
