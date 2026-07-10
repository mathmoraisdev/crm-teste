import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { getBranding } from "@/server/services/branding.service";
import { BrandingStyle } from "@/components/app/BrandingStyle";
import { getPublicMenu } from "@/server/services/menu.service";
import { getDeliverySettings } from "@/server/services/delivery-settings.service";
import { listZones } from "@/server/services/delivery-zone.service";
import { isStoreOpen } from "@/lib/delivery/hours";
import { formatCentsBRL } from "@/lib/money";
import { MenuStorefront } from "@/components/delivery/MenuStorefront";

export const dynamic = "force-dynamic";

/** Conta pelo slug + cardápio LIGADO (senão null → 404 idêntico p/ "não existe"/"desligado"). */
async function resolveAccount(slug: string) {
  const acc = await prisma.user.findUnique({
    where: { publicSlug: slug },
    select: { id: true, menuEnabled: true },
  });
  if (!acc || !acc.menuEnabled) return null;
  return acc;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const acc = await resolveAccount(slug);
  if (!acc) return { title: "Cardápio" };
  const branding = await getBranding(acc.id);
  return { title: `Cardápio — ${branding.appName}` };
}

export default async function CardapioPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const acc = await resolveAccount(slug);
  if (!acc) notFound();

  const [branding, menu, settings, zones] = await Promise.all([
    getBranding(acc.id),
    getPublicMenu(acc.id),
    getDeliverySettings(acc.id),
    listZones(acc.id),
  ]);
  const open = isStoreOpen(settings.hours, new Date(), env.SCHEDULING_TIMEZONE);

  // Faixa de taxa de entrega a partir das zonas ativas (só se entrega ligada).
  const fees = zones.map((z) => z.feeCents);
  const feeLabel =
    settings.deliveryEnabled && fees.length > 0
      ? (() => {
          const min = Math.min(...fees);
          const max = Math.max(...fees);
          if (min === 0 && max === 0) return "Entrega grátis";
          if (min === max) return `Entrega ${formatCentsBRL(min)}`;
          return `Entrega ${formatCentsBRL(min)}–${formatCentsBRL(max)}`;
        })()
      : null;

  // Chips de informação do hero (só o que estiver configurado).
  const infoChips = [
    settings.defaultPrepMinutes > 0 ? `⏱ ~${settings.defaultPrepMinutes} min` : null,
    feeLabel ? `🛵 ${feeLabel}` : null,
    settings.pickupEnabled ? "🏬 Retirada" : null,
    settings.minOrderCents > 0 ? `Mín. ${formatCentsBRL(settings.minOrderCents)}` : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <BrandingStyle palette={branding.palette} />
      <main className="mx-auto min-h-screen w-full max-w-md pb-28">
        {/* Hero com a cor da marca */}
        <header className="bg-gradient-to-br from-brand-500 to-brand-700 px-5 pb-6 pt-8 text-white">
          <div className="flex items-center gap-3">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt={branding.appName}
                className="h-14 w-14 rounded-xl object-cover ring-2 ring-white/30"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/20 text-xl font-bold text-white ring-2 ring-white/30">
                {branding.appName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-xl font-bold leading-tight tracking-[-0.02em]">
                {branding.appName}
              </h1>
              <span
                className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  open ? "bg-white/20 text-white" : "bg-black/25 text-white/90"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${open ? "bg-emerald-300" : "bg-rose-300"}`} />
                {open ? "Aberto agora" : "Fechado no momento"}
              </span>
            </div>
          </div>

          {infoChips.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {infoChips.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </header>

        <div className="px-4 pt-5">
          <MenuStorefront
            slug={slug}
            menu={menu}
            settings={settings}
            zones={zones}
            open={open}
          />
        </div>
      </main>
    </>
  );
}
