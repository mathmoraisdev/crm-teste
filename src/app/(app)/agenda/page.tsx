import { getTenantContext } from "@/lib/tenant";
import { getBookingSettings, getBookingReadiness } from "@/server/services/booking-settings.service";
import { env } from "@/lib/env";
import { CalendarClock } from "lucide-react";
import { AgendaView } from "@/components/AgendaView";
import { SetupRequired } from "@/components/app/SetupRequired";

export const dynamic = "force-dynamic";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ config?: string }>;
}) {
  const ctx = await getTenantContext();
  // Config da Agenda mora aqui (profissionais/horários/comissão/link público),
  // gated por canSettings. Sem ctx (não deveria ocorrer no layout autenticado)
  // cai no fluxo normal sem a aba Configurar.
  if (!ctx) return <AgendaView />;

  const canSettings = ctx.perms.canSettings;
  const ownerId = ctx.tenantUserId;
  const wantsConfig = (await searchParams)?.config === "1";
  const [bookingSettings, bookingReadiness] = await Promise.all([
    getBookingSettings(ownerId),
    getBookingReadiness(ownerId),
  ]);

  // Gate contextual: sem profissional com expediente e serviço com duração, a
  // agenda não tem o que oferecer. Mostra o caminho a quem pode configurar; quem
  // não pode cai no fluxo normal (AgendaView já é passiva e informativa). O CTA
  // aponta p/ ?config=1, que pula o gate e abre a aba Configurar — sem loop.
  if (canSettings && !bookingReadiness.ready && !wantsConfig) {
    return (
      <SetupRequired
        icon={CalendarClock}
        title="Prepare sua agenda"
        description="Cadastre ao menos um profissional com expediente e um serviço com duração para começar a marcar horários."
        href="/agenda?config=1"
        cta="Configurar agenda"
        canSettings
      />
    );
  }

  const publicUrl = bookingSettings.publicSlug
    ? `${env.APP_URL}/agendar/${bookingSettings.publicSlug}`
    : null;

  return (
    <AgendaView
      initialTab={wantsConfig && canSettings ? "config" : "meetings"}
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
