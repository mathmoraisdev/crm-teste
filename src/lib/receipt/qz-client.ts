// Ponte com o QZ Tray (N2): o app QZ Tray roda no PC do caixa e expõe uma API
// JavaScript (window.qz, injetada pelo qz-tray.js incluído no onboarding) que fala
// com a impressora térmica por uma conexão local (WebSocket em localhost). Aqui só
// conectamos, listamos impressoras e enviamos os bytes ESC/POS já prontos (base64).
//
// DECISÃO: não adicionamos o pacote `qz-tray` ao bundle — programamos contra o
// global `window.qz`. Se ele não existir (QZ não instalado/carregado), tudo aqui
// falha explicitamente e o printReceipt cai no modo navegador (N1, sempre disponível).
//
// Assinatura/certificado do QZ (impressão sem prompt em produção) é onboarding do
// cliente — sem isso o QZ mostra um diálogo de permissão na 1ª vez. Fora do escopo.

interface QzConfig {
  // opaco — criado por qz.configs.create e repassado a qz.print
  readonly __qzConfig?: never;
}
interface QzPrintData {
  type: "raw";
  format: "command";
  flavor: "base64";
  data: string;
}
interface QzApi {
  websocket: {
    isActive(): boolean;
    connect(opts?: Record<string, unknown>): Promise<void>;
    disconnect(): Promise<void>;
  };
  printers: { find(query?: string): Promise<string[] | string> };
  configs: { create(printer: string, opts?: Record<string, unknown>): QzConfig };
  print(config: QzConfig, data: QzPrintData[]): Promise<void>;
}

function getQz(): QzApi {
  const qz = (typeof window !== "undefined" ? (window as unknown as { qz?: QzApi }).qz : undefined);
  if (!qz) throw new Error("QZ Tray não carregado (window.qz ausente).");
  return qz;
}

/** true se o QZ Tray JS está presente na página (não garante que o app esteja rodando). */
export function isQzAvailable(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { qz?: unknown }).qz;
}

async function ensureConnected(qz: QzApi): Promise<void> {
  if (!qz.websocket.isActive()) await qz.websocket.connect();
}

/** Lista as impressoras que o QZ Tray enxerga (p/ a config escolher a térmica). */
export async function qzListPrinters(): Promise<string[]> {
  const qz = getQz();
  await ensureConnected(qz);
  const found = await qz.printers.find();
  return Array.isArray(found) ? found : found ? [found] : [];
}

/** Envia bytes raw (base64) à impressora nomeada. Lança se o QZ não estiver ok. */
export async function qzPrintRawBase64(printerName: string, base64: string): Promise<void> {
  const qz = getQz();
  await ensureConnected(qz);
  const config = qz.configs.create(printerName);
  await qz.print(config, [{ type: "raw", format: "command", flavor: "base64", data: base64 }]);
}
