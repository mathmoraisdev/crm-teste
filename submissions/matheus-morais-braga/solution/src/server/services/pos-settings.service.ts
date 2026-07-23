import { prisma } from "@/server/db/client";

// Configuração de impressão do cupom por conta (Fase N2, opt-in). Mora no mesmo
// registro (AccountBranding) que a identidade visual — é config de conta e evita
// uma tabela nova. Não passa pelo getBranding (cosmético): tem seu próprio
// leitor/gravador enxuto p/ não pesar o layout raiz do app.

export type PrintMode = "browser" | "escpos";

export interface PosSettings {
  printMode: PrintMode; // "browser" (N1, default) | "escpos" (QZ Tray, N2)
  printerName: string | null; // impressora do QZ Tray quando escpos
  openDrawer: boolean; // abre a gaveta no pagamento em dinheiro
}

const DEFAULT: PosSettings = { printMode: "browser", printerName: null, openDrawer: false };

/** Lê a config de impressão da conta (com defaults seguros). Barato: 1 query. */
export async function getPosSettings(accountId: string): Promise<PosSettings> {
  try {
    const row = await prisma.accountBranding.findUnique({
      where: { accountId },
      select: { printMode: true, printerName: true, openDrawer: true },
    });
    return {
      printMode: row?.printMode === "escpos" ? "escpos" : "browser",
      printerName: row?.printerName ?? null,
      openDrawer: row?.openDrawer ?? false,
    };
  } catch (e) {
    // Simétrico ao getBranding: tabela ainda não migrada / hiccup não deve
    // quebrar a impressão — degrada p/ o modo navegador (sempre disponível).
    console.warn(`[pos-settings] leitura falhou, usando default: ${e instanceof Error ? e.message : String(e)}`);
    return DEFAULT;
  }
}

/** Grava a config (upsert). Valores ausentes no patch ficam como estão. */
export async function updatePosSettings(
  accountId: string,
  patch: Partial<PosSettings>,
): Promise<PosSettings> {
  const data: Record<string, unknown> = {};
  if (patch.printMode !== undefined) data.printMode = patch.printMode === "escpos" ? "escpos" : "browser";
  if (patch.printerName !== undefined) data.printerName = patch.printerName?.trim() || null;
  if (patch.openDrawer !== undefined) data.openDrawer = !!patch.openDrawer;

  await prisma.accountBranding.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
  return getPosSettings(accountId);
}
