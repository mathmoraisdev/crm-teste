import { prisma } from "@/server/db/client";
import type { WhatsAppNumberStatus, Prisma } from "@prisma/client";
import { sentTodayByNumber } from "@/server/worker/dispatcher";

export interface WhatsAppNumberListItem {
  id: string;
  label: string;
  phone: string;
  status: string;
  dailyCap: number;
  sentToday: number;
  pairingQr: string | null; // QR cru p/ pareamento (a UI converte em imagem)
  // config de atendimento
  displayName: string | null;
  aiModel: string | null;
  systemPromptOverride: string | null;
  persona: string | null;
  knowledgeBase: string | null;
  businessHours: string | null;
  customInstructions: string | null;
  autoReplyEnabled: boolean;
  qualifyEnabled: boolean;
  scheduleEnabled: boolean;
  reminderDayBeforeTemplate: string | null;
  reminderHourBeforeTemplate: string | null;
  replyDelaySeconds: number;
  firstReplyDelaySeconds: number;
  autoPauseOnHumanReply: boolean;
  inactivityResumeMinutes: number;
  contextResetMinutes: number;
}

/**
 * Lista os chips Baileys com o total enviado hoje (reusa `sentTodayByNumber`
 * p/ não duplicar a contagem por número). Vazio nos modos mock/cloud-api.
 */
export async function listWhatsAppNumbers(
  userId: string,
): Promise<WhatsAppNumberListItem[]> {
  const [numbers, counts] = await Promise.all([
    prisma.whatsAppNumber.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        label: true,
        phone: true,
        status: true,
        dailyCap: true,
        pairingQr: true,
        displayName: true,
        aiModel: true,
        systemPromptOverride: true,
        persona: true,
        knowledgeBase: true,
        businessHours: true,
        customInstructions: true,
        autoReplyEnabled: true,
        qualifyEnabled: true,
        scheduleEnabled: true,
        reminderDayBeforeTemplate: true,
        reminderHourBeforeTemplate: true,
        replyDelaySeconds: true,
        firstReplyDelaySeconds: true,
        autoPauseOnHumanReply: true,
        inactivityResumeMinutes: true,
        contextResetMinutes: true,
      },
    }),
    sentTodayByNumber(new Date()),
  ]);
  return numbers.map((n) => ({ ...n, sentToday: counts[n.id] ?? 0 }));
}

// Status que o operador pode setar manualmente pela UI (sem mexer no pareamento).
const MANUAL_STATUSES = new Set<WhatsAppNumberStatus>(["CONNECTED", "PAUSED", "DISABLED"]);

/**
 * Edita um chip: apelido, cap diário e/ou status operacional. O status é
 * limitado a transições manuais seguras (pausar/reativar/desativar) — pareamento
 * e ban continuam a cargo do worker.
 */
export async function updateWhatsAppNumber(
  id: string,
  userId: string,
  data: {
    label?: string;
    dailyCap?: number;
    status?: WhatsAppNumberStatus;
    displayName?: string | null;
    aiModel?: string | null;
    systemPromptOverride?: string | null;
    persona?: string | null;
    knowledgeBase?: string | null;
    businessHours?: string | null;
    customInstructions?: string | null;
    autoReplyEnabled?: boolean;
    qualifyEnabled?: boolean;
    scheduleEnabled?: boolean;
    reminderDayBeforeTemplate?: string | null;
    reminderHourBeforeTemplate?: string | null;
    replyDelaySeconds?: number;
    firstReplyDelaySeconds?: number;
    autoPauseOnHumanReply?: boolean;
    inactivityResumeMinutes?: number;
    contextResetMinutes?: number;
  },
): Promise<void> {
  const exists = await prisma.whatsAppNumber.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw new Error("Número não encontrado");
  if (data.status !== undefined && !MANUAL_STATUSES.has(data.status)) {
    throw new Error("Status não permitido por aqui (use pausar/reativar/desativar).");
  }
  // Monta o patch só com o que veio (undefined = não mexe; null limpa o campo).
  // Build explícito p/ satisfazer Prisma.WhatsAppNumberUpdateInput (Object.fromEntries
  // perde a tipagem e quebra o tsc).
  const patch: Prisma.WhatsAppNumberUpdateInput = {};
  if (data.label !== undefined) patch.label = data.label;
  if (data.dailyCap !== undefined) patch.dailyCap = data.dailyCap;
  if (data.status !== undefined) patch.status = data.status;
  if (data.displayName !== undefined) patch.displayName = data.displayName;
  if (data.aiModel !== undefined) patch.aiModel = data.aiModel;
  if (data.systemPromptOverride !== undefined) patch.systemPromptOverride = data.systemPromptOverride;
  if (data.persona !== undefined) patch.persona = data.persona;
  if (data.knowledgeBase !== undefined) patch.knowledgeBase = data.knowledgeBase;
  if (data.businessHours !== undefined) patch.businessHours = data.businessHours;
  if (data.customInstructions !== undefined) patch.customInstructions = data.customInstructions;
  if (data.autoReplyEnabled !== undefined) patch.autoReplyEnabled = data.autoReplyEnabled;
  if (data.qualifyEnabled !== undefined) patch.qualifyEnabled = data.qualifyEnabled;
  if (data.scheduleEnabled !== undefined) patch.scheduleEnabled = data.scheduleEnabled;
  if (data.reminderDayBeforeTemplate !== undefined) patch.reminderDayBeforeTemplate = data.reminderDayBeforeTemplate;
  if (data.reminderHourBeforeTemplate !== undefined) patch.reminderHourBeforeTemplate = data.reminderHourBeforeTemplate;
  if (data.replyDelaySeconds !== undefined) patch.replyDelaySeconds = data.replyDelaySeconds;
  if (data.firstReplyDelaySeconds !== undefined) patch.firstReplyDelaySeconds = data.firstReplyDelaySeconds;
  if (data.autoPauseOnHumanReply !== undefined) patch.autoPauseOnHumanReply = data.autoPauseOnHumanReply;
  if (data.inactivityResumeMinutes !== undefined) patch.inactivityResumeMinutes = data.inactivityResumeMinutes;
  if (data.contextResetMinutes !== undefined) patch.contextResetMinutes = data.contextResetMinutes;
  await prisma.whatsAppNumber.update({ where: { id }, data: patch });
}

// Status a partir dos quais um chip pode ser forçado a reparear. Inclui
// CONNECTING: um número preso "pareando" (QR fechado sem escanear) não cai
// sozinho p/ um status offline — sem isto ficava sem saída na UI (nenhum botão
// reabria o QR). Reparear a partir de CONNECTING apenas reinicia o pareamento.
const RECONNECTABLE_STATUSES = new Set<WhatsAppNumberStatus>([
  "CONNECTING",
  "BANNED",
  "LOGGED_OUT",
  "DISABLED",
]);

/**
 * Força o re-pareamento de um chip offline (BANIDO/DESLOGADO/DESATIVADO):
 * apaga as credenciais Baileys mortas (tabela WhatsAppAuthState) e volta o
 * status p/ CONNECTING. O worker então gera um QR novo p/ reescanear.
 *
 * As configs de atendimento (system prompt, modelo de IA, persona, base de
 * conhecimento, delays, toggles…) NÃO ficam aqui — vivem na própria linha
 * WhatsAppNumber, que é preservada. Só as credenciais de sessão são apagadas.
 * Por isso reconectar mantém TUDO que já estava configurado no número.
 */
export async function reconnectWhatsAppNumber(
  id: string,
  userId: string,
): Promise<void> {
  const rec = await prisma.whatsAppNumber.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  });
  if (!rec) throw new Error("Número não encontrado");
  if (!RECONNECTABLE_STATUSES.has(rec.status)) {
    throw new Error(
      "Só dá pra reconectar um número offline ou ainda em pareamento (não um já conectado).",
    );
  }
  // Apaga as creds mortas → o Baileys gera um QR novo em vez de tentar reusar a
  // sessão derrubada (que cairia de novo em 401). Tudo numa transação p/ não
  // deixar o número CONNECTING com metade das creds antigas ainda no banco.
  await prisma.$transaction([
    prisma.whatsAppAuthState.deleteMany({ where: { numberId: id } }),
    prisma.whatsAppNumber.update({
      where: { id },
      data: { status: "CONNECTING", bannedAt: null, lastError: null, pairingQr: null },
    }),
  ]);
}

/** Remove um chip do CRM. Jobs/mensagens/leads ligados ficam órfãos (SetNull). */
export async function deleteWhatsAppNumber(id: string, userId: string): Promise<void> {
  const exists = await prisma.whatsAppNumber.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw new Error("Número não encontrado");
  await prisma.whatsAppNumber.delete({ where: { id } });
}
