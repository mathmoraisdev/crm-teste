// Impressão do cupom no cliente. Dois caminhos, escolhidos pela config da conta:
//  • browser (N1, default): um <iframe> oculto carrega /recibo/[id]?print=1 e o
//    AutoPrint da rota dispara window.print(). Universal — qualquer impressora do SO.
//  • escpos (N2, opt-in): busca os bytes ESC/POS no servidor e envia à térmica via
//    QZ Tray (corte de papel, gaveta, silencioso). Cai no browser se o QZ falhar.
//
// Em kiosk (chrome --kiosk-printing) o print() do caminho browser imprime sem
// diálogo — orientar no onboarding se quiser eliminar o clique de confirmação.
import { isQzAvailable, qzPrintRawBase64 } from "./qz-client";
import { buildKitchenEscposBytes } from "./escpos";
import type { KitchenTicket } from "./kitchen";

export type ReceiptWidthMM = 80 | 58;

interface PosSettings {
  printMode: "browser" | "escpos";
  printerName: string | null;
  openDrawer: boolean;
}

// Cache simples da config (evita um GET por clique). Invalida sozinho após o TTL.
let settingsCache: { at: number; value: PosSettings } | null = null;
const SETTINGS_TTL_MS = 60_000;

async function fetchPosSettings(): Promise<PosSettings | null> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;
  try {
    const res = await fetch("/api/caixa/pos-settings", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { settings: PosSettings };
    settingsCache = { at: now, value: data.settings };
    return data.settings;
  } catch {
    return null;
  }
}

/** Imprime (ou reimprime) o cupom da comanda. Assíncrono; seguro em onClick. */
export async function printReceipt(orderId: string, width: ReceiptWidthMM = 80): Promise<void> {
  const settings = await fetchPosSettings();
  if (settings?.printMode === "escpos" && settings.printerName && isQzAvailable()) {
    try {
      const res = await fetch(`/api/vendas/orders/${orderId}/escpos?w=${width}`, { cache: "no-store" });
      if (res.ok) {
        const { data } = (await res.json()) as { data: string };
        await qzPrintRawBase64(settings.printerName, data);
        return;
      }
    } catch {
      // QZ indisponível/erro de impressão → cai no navegador (nunca fica sem cupom).
    }
  }
  printReceiptBrowser(orderId, width);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Envia as comandas de PRODUÇÃO (N3), um ticket por setor. Rota conforme a config:
 *  • escpos + QZ: um job por setor na impressora configurada (cortes separados).
 *  • browser: abre a rota /producao (um iframe) que imprime todos os setores com
 *    quebra de página entre eles.
 * Retorna a quantidade de tickets (0 = nenhum item tem setor de produção).
 */
export async function printKitchenTickets(orderId: string): Promise<number> {
  let tickets: KitchenTicket[] = [];
  try {
    const res = await fetch(`/api/vendas/orders/${orderId}/kitchen`, { cache: "no-store" });
    if (res.ok) tickets = ((await res.json()) as { tickets: KitchenTicket[] }).tickets ?? [];
  } catch {
    return 0;
  }
  if (tickets.length === 0) return 0;

  const settings = await fetchPosSettings();
  if (settings?.printMode === "escpos" && settings.printerName && isQzAvailable()) {
    try {
      for (const t of tickets) {
        const base64 = uint8ToBase64(buildKitchenEscposBytes(t, 32));
        await qzPrintRawBase64(settings.printerName, base64);
      }
      return tickets.length;
    } catch {
      // QZ falhou → cai no navegador.
    }
  }
  printReceiptBrowserSrc(`/producao/${orderId}?print=1`);
  return tickets.length;
}

/** Caminho universal (N1): iframe oculto + AutoPrint. Fallback: nova aba. */
function printReceiptBrowser(orderId: string, width: ReceiptWidthMM): void {
  printReceiptBrowserSrc(`/recibo/${orderId}?print=1&w=${width}`);
}

/** Carrega uma rota de impressão standalone num iframe oculto e limpa depois. */
function printReceiptBrowserSrc(src: string): void {
  if (typeof document === "undefined") return;

  try {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    Object.assign(iframe.style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      width: "0",
      height: "0",
      border: "0",
      visibility: "hidden",
    } as CSSStyleDeclaration);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      iframe.remove();
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      // AutoPrint (na rota) já chama print(); só precisamos limpar depois.
      if (win) win.addEventListener("afterprint", cleanup, { once: true });
      // Rede de segurança: se afterprint não vier (navegador/plataforma), remove.
      setTimeout(cleanup, 60_000);
    };
    // Se o iframe falhar por completo, abre numa aba como fallback.
    iframe.onerror = () => {
      cleanup();
      window.open(src, "_blank", "noopener");
    };

    iframe.src = src;
    document.body.appendChild(iframe);
  } catch {
    // Ambiente sem suporte a iframe programático: cai no window.open.
    window.open(src, "_blank", "noopener");
  }
}
