import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getBranding } from "@/server/services/branding.service";
import { BrandingStyle } from "@/components/app/BrandingStyle";
import { getPublicOrderTracking } from "@/server/services/order-tracking.service";
import { OrderTracker } from "@/components/delivery/OrderTracker";

export const dynamic = "force-dynamic";

/** Conta pelo slug + cardápio LIGADO (404 idêntico p/ inexistente/desligado). */
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
  params: Promise<{ slug: string; id: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const acc = await resolveAccount(slug);
  if (!acc) return { title: "Pedido" };
  const branding = await getBranding(acc.id);
  return { title: `Seu pedido — ${branding.appName}` };
}

export default async function PedidoTrackingPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const acc = await resolveAccount(slug);
  if (!acc) notFound();

  const [branding, tracking] = await Promise.all([
    getBranding(acc.id),
    getPublicOrderTracking(acc.id, id),
  ]);
  // Pedido inexistente ou de outra conta → 404 idêntico (não vaza existência).
  if (!tracking) notFound();

  return (
    <div data-theme={branding.publicTheme} className="min-h-screen bg-surface">
      <BrandingStyle palette={branding.palette} />
      <main className="mx-auto w-full max-w-md px-4 py-8">
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
            <p className="text-sm text-slate-500">Acompanhe seu pedido</p>
          </div>
        </header>

        <OrderTracker slug={slug} orderId={id} initial={tracking} />
      </main>
    </div>
  );
}
