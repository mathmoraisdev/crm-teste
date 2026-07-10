import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { openOrder, addItem } from "./order.service";
import { resolveModifierSelection } from "./modifier.service";
import { getDeliverySettings } from "./delivery-settings.service";
import { resolveZoneFee } from "./delivery-zone.service";
import { getPublicMenu } from "./menu.service";
import { isStoreOpen } from "@/lib/delivery/hours";
import { canSellOnline } from "./entitlements";
import { isAccountActive } from "@/server/services/account.service";
import { createOnlinePixCharge } from "./online-payment.service";
import { notifyMerchantNewOnlineOrder } from "./fulfillment-notify.service";

export interface PlaceOnlineOrderInput {
  mode: "DELIVERY" | "RETIRADA";
  customerName: string;
  customerPhone: string;
  items: { catalogItemId: string; quantity: number; note?: string; optionIds?: string[] }[];
  address?: {
    neighborhoodZoneId?: string;
    street?: string;
    number?: string;
    complement?: string;
    reference?: string;
  };
  payment: "online" | "on_delivery";
  note?: string;
}

/**
 * Cria um pedido online (Order source=ONLINE, fulfillmentStatus=PENDENTE) reusando
 * openOrder/addItem do PDV. Preço e taxa vêm SEMPRE do servidor (snapshot). Valida
 * loja aberta, modalidades, itens do cardápio, pedido mínimo e gates de pagamento.
 * Erros de regra vêm prefixados "CODE:mensagem" p/ o handler mapear p/ 409.
 */
export async function placeOnlineOrder(accountId: string, input: PlaceOnlineOrderInput) {
  const [settings, menu] = await Promise.all([getDeliverySettings(accountId), getPublicMenu(accountId)]);

  if (!isStoreOpen(settings.hours, new Date(), env.SCHEDULING_TIMEZONE)) {
    throw new Error("STORE_CLOSED:Loja fechada no momento.");
  }
  if (input.mode === "DELIVERY" && !settings.deliveryEnabled) {
    throw new Error("MODE_OFF:Entrega indisponível.");
  }
  if (input.mode === "RETIRADA" && !settings.pickupEnabled) {
    throw new Error("MODE_OFF:Retirada indisponível.");
  }

  // Itens válidos = os do cardápio público (já filtra ativo/visível/estoque).
  const validById = new Map(menu.categories.flatMap((c) => c.items).map((i) => [i.id, i]));
  if (!input.items.length) throw new Error("EMPTY:Carrinho vazio.");
  for (const li of input.items) {
    const m = validById.get(li.catalogItemId);
    if (!m || !m.available) throw new Error("ITEM_UNAVAILABLE:Um item saiu do cardápio.");
  }
  // Adicionais: resolve cada linha CONTRA o banco (fonte de verdade do preço; nunca
  // confia no client). É async → resolve antes do subtotal (não cabe no reduce).
  // Lança "MODIFIER:..." p/ o handler mapear p/ 409 (código já em KNOWN_CODES).
  const resolved = await Promise.all(
    input.items.map((li) => resolveModifierSelection(accountId, li.catalogItemId, li.optionIds ?? [])),
  );
  // Snapshot de preço pelo servidor: base do cardápio + Σ deltas dos adicionais.
  const subtotal = input.items.reduce(
    (s, li, i) => s + (validById.get(li.catalogItemId)!.priceCents + resolved[i].deltaCents) * Math.max(1, li.quantity),
    0,
  );

  // Taxa + pedido mínimo (zona vence se mais restritiva).
  let deliveryFeeCents = 0;
  let deliveryZoneId: string | null = null;
  if (input.mode === "DELIVERY") {
    if (!input.address?.neighborhoodZoneId) throw new Error("ZONE_REQUIRED:Escolha o bairro.");
    const zone = await resolveZoneFee(accountId, input.address.neighborhoodZoneId);
    deliveryFeeCents = zone.feeCents;
    deliveryZoneId = zone.zoneId;
    if (zone.minOrderCents != null && subtotal < zone.minOrderCents) {
      throw new Error("MIN_ORDER:Pedido mínimo não atingido.");
    }
  }
  if (subtotal < settings.minOrderCents) throw new Error("MIN_ORDER:Pedido mínimo não atingido.");

  // Pagamento online exige entitlement + billing ativo.
  const wantsOnline = input.payment === "online";
  if (wantsOnline) {
    if (!settings.payOnlineEnabled) throw new Error("PAY_OFF:Pagamento online indisponível.");
    if (!(await canSellOnline(accountId))) throw new Error("PAY_OFF:Pagamento online indisponível.");
    if (!(await isAccountActive(accountId))) throw new Error("PAY_OFF:Pagamento online indisponível.");
  } else if (!settings.payOnDeliveryEnabled) {
    throw new Error("PAY_OFF:Pagamento na entrega indisponível.");
  }

  // Abre a comanda ONLINE (openOrder cria/vincula o lead pelo telefone).
  // openedById = a própria conta (dono é o "operador" do pedido online).
  const dto = await openOrder(accountId, {
    openedById: accountId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
  });

  for (const li of input.items) {
    await addItem(accountId, dto.id, {
      catalogItemId: li.catalogItemId,
      quantity: li.quantity,
      ...(li.optionIds?.length ? { modifierOptionIds: li.optionIds } : {}),
      ...(li.note ? { customFields: { obs: li.note } } : {}),
    });
  }

  // Metadados de delivery + fulfillment (campos que openOrder não cobre) + nº
  // sequencial do pedido online POR conta, atribuído na CRIAÇÃO. O advisory lock
  // por conta serializa o max+1 (dois pedidos simultâneos não colidem no nº).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-online:${accountId}`}))`;
    const agg = await tx.order.aggregate({ where: { accountId }, _max: { onlineNumber: true } });
    const onlineNumber = (agg._max.onlineNumber ?? 0) + 1;
    await tx.order.update({
      where: { id: dto.id },
      data: {
        onlineNumber,
        orderType: input.mode === "DELIVERY" ? "DELIVERY" : "RETIRADA",
        source: "ONLINE",
        fulfillmentStatus: "PENDENTE",
        customerPhone: input.customerPhone.trim(),
        deliveryFeeCents: input.mode === "DELIVERY" ? deliveryFeeCents : null,
        deliveryZoneId,
        deliveryAddress: input.mode === "DELIVERY" ? (input.address as object) : undefined,
        note: input.note?.trim() || null,
      },
    });
  });

  let pix: { copiaECola: string; qrBase64?: string } | undefined;
  if (wantsOnline) {
    const totalCents = subtotal + deliveryFeeCents;
    pix = await createOnlinePixCharge(accountId, dto.id, totalCents, input.customerName);
  } else {
    // Pagar-na-entrega já entra "vivo": avisa o lojista na hora (best-effort).
    // Pago-online só vira pedido válido quando o webhook confirma → aviso sai lá.
    void notifyMerchantNewOnlineOrder(accountId, dto.id).catch(() => {});
  }

  return { orderId: dto.id, payment: input.payment, pix };
}
