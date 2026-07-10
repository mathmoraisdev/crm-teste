import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { getTenantContext } from "@/lib/tenant";
import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";
import { getDeliverySettings } from "@/server/services/delivery-settings.service";
import { listZones } from "@/server/services/delivery-zone.service";
import { canUseDelivery } from "@/server/services/entitlements";
import { getBusinessTemplateId } from "@/server/services/account.service";
import { getTemplate } from "@/lib/business-templates";
import { DeliveryConfig } from "@/components/delivery/DeliveryConfig";

export const dynamic = "force-dynamic";

export default async function DeliveryConfigPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  const ownerId = ctx.tenantUserId;

  const [settings, zones, u, entitled, catRows, businessTemplateId] = await Promise.all([
    getDeliverySettings(ownerId),
    listZones(ownerId, { includeInactive: true }),
    prisma.user.findUnique({ where: { id: ownerId }, select: { publicSlug: true, menuEnabled: true } }),
    canUseDelivery(ownerId),
    // Categorias em uso no cardápio (mesmos filtros do cardápio público) p/ reordenar.
    prisma.catalogItem.findMany({
      where: { accountId: ownerId, active: true, menuVisible: true },
      select: { menuCategory: true },
    }),
    getBusinessTemplateId(ownerId),
  ]);

  const slug = u?.publicSlug ?? null;
  const publicUrl = slug ? `${env.APP_URL}/cardapio/${slug}` : null;
  // Ramo alimentação fala "cardápio"; demais ramos falam "vitrine" (mesmo recurso).
  const isFood = (businessTemplateId ? getTemplate(businessTemplateId)?.category : null) === "alimentacao";

  // Nomes distintos de categoria (trim), em ordem alfabética; sem o balde "Outros".
  const menuCategories = [
    ...new Set(catRows.map((r) => r.menuCategory?.trim()).filter((c): c is string => !!c)),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-[720px]">
      <header className="mb-7">
        <a href="/configuracoes" className="text-xs text-slate-500 hover:text-ink">
          ← Configurações
        </a>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">
          {isFood ? "Cardápio & Delivery" : "Vitrine & Delivery"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isFood
            ? "Publique seu cardápio online, configure entrega/retirada, taxas por bairro e pagamento Pix."
            : "Publique sua vitrine online, configure entrega/retirada, taxas por bairro e pagamento Pix."}
        </p>
      </header>

      <DeliveryConfig
        canEdit={ctx.perms.canSettings}
        entitled={entitled}
        isFood={isFood}
        menuCategories={menuCategories}
        initialCategoryOrder={settings.categoryOrder}
        initial={{
          menuEnabled: u?.menuEnabled ?? false,
          publicSlug: slug,
          publicUrl,
          deliveryEnabled: settings.deliveryEnabled,
          pickupEnabled: settings.pickupEnabled,
          payOnlineEnabled: settings.payOnlineEnabled,
          payOnDeliveryEnabled: settings.payOnDeliveryEnabled,
          minOrderCents: settings.minOrderCents,
          defaultPrepMinutes: settings.defaultPrepMinutes,
          hours: settings.hours,
        }}
        initialZones={zones}
      />
    </div>
  );
}
