// Renderizador ESC/POS (N2): consome o MESMO ReceiptModel da N1 e emite os bytes
// que uma impressora térmica entende — init, alinhamento, negrito, corte de papel
// e (opcional) pulso de gaveta. Pura, sem hardware: quem envia os bytes é o
// qz-client (via QZ Tray). Assim a formatação continua com uma só fonte de verdade
// (o model), e este módulo só traduz para os comandos da bobina.
//
// Referência dos comandos (padrão Epson ESC/POS, aceito por Bematech/Elgin/etc.):
//   ESC @        (1B 40)          inicializa/limpa formatação
//   ESC a n      (1B 61 n)        alinhamento 0=esq 1=centro 2=dir
//   ESC E n      (1B 45 n)        negrito on/off
//   ESC t n      (1B 74 n)        seleciona code page (19 = CP858, com acentos/€)
//   GS V m       (1D 56 m)        corte de papel (66/0x42 = corte parcial c/ avanço)
//   ESC p m t1 t2(1B 70 …)        pulso de gaveta (m=0 → pino 2; tempos on/off)
import type { ReceiptModel } from "./model";
import type { KitchenTicket } from "./kitchen";

export const ESC = 0x1b;
export const GS = 0x1d;

/** CP858 (Latin-1 + €) — code page comum em térmicas p/ acentos do português.
 * Mapeamento simples: mantém ASCII; acima de 0x7F cai no byte Latin-1 (0xFF mask).
 * Não é perfeito p/ todos os glifos, mas cobre á/ã/ç/é/… no CP858. */
function encodeText(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
  return out;
}

class ByteBuf {
  private bytes: number[] = [];
  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  text(s: string): this {
    this.bytes.push(...encodeText(s));
    return this;
  }
  /** escreve a linha + LF */
  line(s = ""): this {
    return this.text(s).raw(0x0a);
  }
  align(mode: "left" | "center" | "right"): this {
    return this.raw(ESC, 0x61, mode === "center" ? 1 : mode === "right" ? 2 : 0);
  }
  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export interface EscposOptions {
  /** abre a gaveta de dinheiro junto do cupom (só faz sentido em pagamento em dinheiro) */
  openDrawer?: boolean;
}

/** Traduz o modelo de recibo em bytes ESC/POS prontos p/ enviar à térmica. */
export function buildEscposBytes(model: ReceiptModel, opts: EscposOptions = {}): Uint8Array {
  const b = new ByteBuf();
  const divider = "-".repeat(model.width);

  b.raw(ESC, 0x40); // init
  b.raw(ESC, 0x74, 0x13); // code page CP858 (0x13 = 19)

  // Cabeçalho
  b.align("center").bold(true).line(model.header.title).bold(false);
  if (model.header.subtitle) b.line(model.header.subtitle);

  b.align("left").line(divider);
  b.line(model.header.docNumber);
  if (model.header.dateTime) b.line(model.header.dateTime);
  if (model.header.customer) b.line(`Cliente: ${model.header.customer}`);
  b.line(divider);

  // Itens (já vêm padronizados em `rendered`, largura fixa e valor à direita)
  for (const l of model.lines) b.line(l.rendered);
  b.line(divider);

  // Desdobramento (subtotal/desconto/taxa/gorjeta) + TOTAL + troco + pagamento
  for (const s of model.summary) b.line(s.rendered);
  b.bold(true).line(model.totals.rendered).bold(false);
  if (model.change) b.line(model.change.rendered);
  for (const p of model.payments) b.line(p.rendered);
  b.line(divider);

  // Rodapé
  b.align("center");
  for (const f of model.footer) b.line(f);

  // Avanço + corte
  b.raw(0x0a, 0x0a, 0x0a);
  b.raw(GS, 0x56, 0x42, 0x00); // GS V 66 0 — corte parcial com avanço

  // Gaveta (opcional): pulso no pino, tempos on=25ms off=250ms (0x19/0xFA).
  if (opts.openDrawer) b.raw(ESC, 0x70, 0x00, 0x19, 0xfa);

  return b.done();
}

/** Ticket de cozinha (N3) em bytes ESC/POS — SEM valores, corta ao final, nunca
 * abre gaveta. Fonte grande no setor p/ leitura rápida na produção. */
export function buildKitchenEscposBytes(ticket: KitchenTicket, width: 32 | 24 = 32): Uint8Array {
  const b = new ByteBuf();
  const divider = "-".repeat(width);

  b.raw(ESC, 0x40); // init
  b.raw(ESC, 0x74, 0x13); // CP858

  // Setor em destaque (negrito + fonte dupla altura/largura via GS ! 0x11)
  b.align("center").bold(true).raw(GS, 0x21, 0x11);
  b.line(ticket.sector.toUpperCase());
  b.raw(GS, 0x21, 0x00).bold(false); // volta fonte normal

  b.align("left").line(divider);
  b.line(ticket.header.docNumber);
  if (ticket.header.customerName) b.line(ticket.header.customerName);
  if (ticket.header.dateTime) b.line(ticket.header.dateTime);
  b.line(divider);

  for (const l of ticket.lines) {
    b.bold(true).line(`${l.quantity}x ${l.name}`).bold(false);
    if (l.note) b.line(`   * ${l.note}`);
  }
  if (ticket.header.note) {
    b.line(divider);
    b.line(`Obs: ${ticket.header.note}`);
  }

  b.raw(0x0a, 0x0a, 0x0a);
  b.raw(GS, 0x56, 0x42, 0x00); // corte parcial
  return b.done();
}
