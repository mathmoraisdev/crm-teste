import { z } from "zod";
import { prisma } from "@/server/db/client";

/**
 * Configurações do auto-agendamento online (Onda F). Vivem no User dono da conta:
 * `publicSlug` (identidade pública, @unique) + toggles/config do booking. Nada aqui
 * é público — quem lê o link é a rota `/agendar/[slug]`; este serviço é o painel
 * interno (Configurações) que liga o booking, edita o slug e ajusta a grade.
 */

export interface BookingSettings {
  publicSlug: string | null;
  bookingEnabled: boolean;
  bookingLeadMinutes: number;
  bookingHorizonDays: number;
  bookingSlotStep: number;
}

/**
 * PURA: normaliza um texto livre num slug de URL — minúsculas, ASCII (sem acento),
 * só [a-z0-9-], sem hífen nas bordas nem duplicado. Vazio (ou nada aproveitável)
 * → "". É a base do link público; o chamador decide o que fazer com o "".
 */
export function slugify(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // qualquer não-alfanumérico vira hífen
    .replace(/^-+|-+$/g, ""); // apara hífens das bordas
}

const patchSchema = z.object({
  bookingEnabled: z.boolean().optional(),
  bookingLeadMinutes: z.number().int().min(0, "Antecedência inválida.").optional(),
  bookingHorizonDays: z
    .number()
    .int()
    .min(1, "Janela inválida.")
    .max(180, "Janela inválida.")
    .optional(),
  bookingSlotStep: z
    .number()
    .int()
    .min(5, "Granularidade inválida.")
    .max(120, "Granularidade inválida.")
    .optional(),
  publicSlug: z.string().optional(),
});

export type BookingSettingsPatch = z.input<typeof patchSchema>;

function toSettings(u: {
  publicSlug: string | null;
  bookingEnabled: boolean;
  bookingLeadMinutes: number;
  bookingHorizonDays: number;
  bookingSlotStep: number;
}): BookingSettings {
  return {
    publicSlug: u.publicSlug,
    bookingEnabled: u.bookingEnabled,
    bookingLeadMinutes: u.bookingLeadMinutes,
    bookingHorizonDays: u.bookingHorizonDays,
    bookingSlotStep: u.bookingSlotStep,
  };
}

export async function getBookingSettings(accountId: string): Promise<BookingSettings> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      publicSlug: true,
      bookingEnabled: true,
      bookingLeadMinutes: true,
      bookingHorizonDays: true,
      bookingSlotStep: true,
    },
  });
  return toSettings(u);
}

/** Confere que `slug` está livre (ou já é desta conta). Lança mensagem legível se não. */
async function assertSlugAvailable(accountId: string, slug: string): Promise<void> {
  const taken = await prisma.user.findFirst({
    where: { publicSlug: slug, id: { not: accountId } },
    select: { id: true },
  });
  if (taken) throw new Error("Esse endereço já está em uso.");
}

/**
 * Aplica um patch nas configs de booking (escopo por conta). Valida limites com
 * zod; ao mudar o slug, normaliza (`slugify`), exige não-vazio e confere unicidade.
 */
export async function setBookingSettings(
  accountId: string,
  patch: BookingSettingsPatch,
): Promise<BookingSettings> {
  const parsed = patchSchema.parse(patch);
  const data: {
    bookingEnabled?: boolean;
    bookingLeadMinutes?: number;
    bookingHorizonDays?: number;
    bookingSlotStep?: number;
    publicSlug?: string;
  } = {};
  if (parsed.bookingEnabled !== undefined) data.bookingEnabled = parsed.bookingEnabled;
  if (parsed.bookingLeadMinutes !== undefined) data.bookingLeadMinutes = parsed.bookingLeadMinutes;
  if (parsed.bookingHorizonDays !== undefined) data.bookingHorizonDays = parsed.bookingHorizonDays;
  if (parsed.bookingSlotStep !== undefined) data.bookingSlotStep = parsed.bookingSlotStep;
  if (parsed.publicSlug !== undefined) {
    const slug = slugify(parsed.publicSlug);
    if (!slug) throw new Error("Endereço inválido. Use letras e números.");
    await assertSlugAvailable(accountId, slug);
    data.publicSlug = slug;
  }
  const u = await prisma.user.update({
    where: { id: accountId },
    data,
    select: {
      publicSlug: true,
      bookingEnabled: true,
      bookingLeadMinutes: true,
      bookingHorizonDays: true,
      bookingSlotStep: true,
    },
  });
  return toSettings(u);
}

/**
 * Garante que a conta tem um `publicSlug`. Já tem → devolve o atual (idempotente).
 * Senão gera de `appName` (branding) ou do nome do dono, resolvendo colisão com
 * sufixo curto (`-2`, `-3`…). `fallback` cobre conta sem nome nem branding.
 */
export async function ensureSlug(accountId: string): Promise<string> {
  const existing = await prisma.user.findUniqueOrThrow({
    where: { id: accountId },
    select: { publicSlug: true, name: true },
  });
  if (existing.publicSlug) return existing.publicSlug;

  const branding = await prisma.accountBranding.findUnique({
    where: { accountId },
    select: { appName: true },
  });
  const base =
    slugify(branding?.appName ?? "") ||
    slugify(existing.name ?? "") ||
    "agenda";

  // Procura o primeiro sufixo livre: base, base-2, base-3…
  let slug = base;
  for (let n = 2; ; n++) {
    const taken = await prisma.user.findFirst({
      where: { publicSlug: slug },
      select: { id: true },
    });
    if (!taken) break;
    slug = `${base}-${n}`;
  }
  await prisma.user.update({ where: { id: accountId }, data: { publicSlug: slug } });
  return slug;
}
