import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { getBranding } from "@/server/services/branding.service";
import { BrandingStyle } from "@/components/app/BrandingStyle";
import {
  listBookableServices,
  listBookableProfessionals,
} from "@/server/services/booking-availability.service";
import { enumerateLocalDates } from "@/lib/agenda/availability";
import { BookingWidget } from "@/components/agendar/BookingWidget";

export const dynamic = "force-dynamic";

const TZ = env.SCHEDULING_TIMEZONE;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Conta pelo slug + booking LIGADO (senão null → 404). */
async function resolveAccount(slug: string) {
  const acc = await prisma.user.findUnique({
    where: { publicSlug: slug },
    select: { id: true, bookingEnabled: true, bookingHorizonDays: true },
  });
  if (!acc || !acc.bookingEnabled) return null;
  return acc;
}

/** Dias ofertados (do fuso da agenda), com rótulo pt-BR — evita drift do fuso do cliente. */
function buildDateOptions(horizonDays: number): { value: string; label: string }[] {
  const now = new Date();
  const days = enumerateLocalDates(now, new Date(now.getTime() + horizonDays * DAY_MS), TZ);
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  return days.map((d) => {
    const value = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    // Formata a partir do meio-dia UTC do dia local (evita virada de fuso na borda).
    const noonish = new Date(Date.UTC(d.year, d.month - 1, d.day, 12, 0, 0));
    return { value, label: fmt.format(noonish) };
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const acc = await resolveAccount(slug);
  if (!acc) return { title: "Agendamento" };
  const branding = await getBranding(acc.id);
  return { title: `Agendar — ${branding.appName}` };
}

export default async function AgendarPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const acc = await resolveAccount(slug);
  if (!acc) notFound();

  const [branding, services, professionals] = await Promise.all([
    getBranding(acc.id),
    listBookableServices(acc.id),
    listBookableProfessionals(acc.id),
  ]);
  const ready = services.length > 0 && professionals.length > 0;
  const dateOptions = buildDateOptions(acc.bookingHorizonDays);

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
          <div>
            <h1 className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
              {branding.appName}
            </h1>
            <p className="text-sm text-slate-500">Agende seu horário online</p>
          </div>
        </header>

        {ready ? (
          <BookingWidget
            slug={slug}
            services={services}
            professionals={professionals}
            dateOptions={dateOptions}
            tz={TZ}
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-card px-4 py-10 text-center">
            <p className="text-sm text-slate-500">
              Agendamento indisponível no momento. Fale direto com o estabelecimento.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
