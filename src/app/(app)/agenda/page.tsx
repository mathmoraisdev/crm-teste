import { getTenantContext } from "@/lib/tenant";
import { getBookingSettings, getBookingReadiness } from "@/server/services/booking-settings.service";
import { env } from "@/lib/env";
import { AgendaView } from "@/components/AgendaView";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const ctx = await getTenantContext();
  // Config da Agenda mora aqui (profissionais/horários/comissão/link público),
  // gated por canSettings. Sem ctx (não deveria ocorrer no layout autenticado)
  // cai no fluxo normal sem a aba Configurar.
  if (!ctx) return <AgendaView />;

  const canSettings = ctx.perms.canSettings;
  const ownerId = ctx.tenantUserId;
  const [bookingSettings, bookingReadiness] = await Promise.all([
    getBookingSettings(ownerId),
    getBookingReadiness(ownerId),
  ]);
  const publicUrl = bookingSettings.publicSlug
    ? `${env.APP_URL}/agendar/${bookingSettings.publicSlug}`
    : null;

  return (
    <AgendaView
      config={{
        canSettings,
        booking: {
          initial: { ...bookingSettings, publicUrl },
          readiness: bookingReadiness,
        },
      }}
    />
  );
}
