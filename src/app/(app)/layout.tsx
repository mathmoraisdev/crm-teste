import { Sidebar } from "@/components/app/Sidebar";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { getTenantContext } from "@/lib/tenant";
import { getBranding } from "@/server/services/branding.service";
import { BrandingStyle } from "@/components/app/BrandingStyle";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getCurrentUserId();
  const ctx = await getTenantContext();
  const [user, branding] = await Promise.all([
    userId ? getUserById(userId) : null,
    ctx ? getBranding(ctx.tenantUserId) : null,
  ]);
  const isAdmin = isAdminEmail(user?.email);
  // Dono da conta (ADMIN sem ownerId) vê a aba "Equipe".
  const isAccountAdmin = ctx?.role === "ADMIN";

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {branding && <BrandingStyle palette={branding.palette} />}
      <Sidebar isAdmin={isAdmin} isAccountAdmin={isAccountAdmin} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 2xl:max-w-[1600px]">
          {children}
        </div>
      </main>
    </div>
  );
}
