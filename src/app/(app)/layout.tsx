import { Sidebar } from "@/components/app/Sidebar";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { getTenantContext } from "@/lib/tenant";
import { getBranding } from "@/server/services/branding.service";
import { BrandingStyle } from "@/components/app/BrandingStyle";
import { getBusinessTemplateId } from "@/server/services/account.service";
import { getTemplate } from "@/lib/business-templates";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getCurrentUserId();
  const ctx = await getTenantContext();
  const [user, branding, businessTemplateId] = await Promise.all([
    userId ? getUserById(userId) : null,
    ctx ? getBranding(ctx.tenantUserId) : null,
    ctx ? getBusinessTemplateId(ctx.tenantUserId) : null,
  ]);
  const isAdmin = isAdminEmail(user?.email);
  // Dono da conta (ADMIN sem ownerId) vê a aba "Equipe".
  const isAccountAdmin = ctx?.role === "ADMIN";
  // Ramo da conta → categoria (Fase 3 adapta o menu; null = mostra tudo).
  const category = businessTemplateId ? getTemplate(businessTemplateId)?.category ?? null : null;

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {branding && <BrandingStyle palette={branding.palette} />}
      <Sidebar
        isAdmin={isAdmin}
        isAccountAdmin={isAccountAdmin}
        category={category}
        branding={branding ? { logoUrl: branding.logoUrl, appName: branding.appName } : undefined}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 2xl:max-w-[1600px]">
          {children}
        </div>
      </main>
    </div>
  );
}
