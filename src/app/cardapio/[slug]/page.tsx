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

  return (
    <>
      <BrandingStyle palette={branding.palette} />
      <main className="mx-auto min-h-screen w-full max-w-md px-4 py-8">
        <header className="mb-6 flex items-center gap-3">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={branding.appName}
              className="h-11 w-11 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-500 text-lg font-bold text-white">
              {branding.appName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
              {branding.appName}
            </h1>
            <p className="text-sm text-slate-500">Peça pelo cardápio online</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              open
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
            }`}
          >
            {open ? "Aberto" : "Fechado"}
          </span>
        </header>

        <MenuStorefront
          slug={slug}
          menu={menu}
          settings={settings}
          zones={zones}
          open={open}
        />
      </main>
    </>
  );
}
