import { Sidebar } from "@/components/app/Sidebar";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { getTenantContext } from "@/lib/tenant";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getCurrentUserId();
  const [user, ctx] = await Promise.all([
    userId ? getUserById(userId) : null,
    getTenantContext(),
  ]);
  const isAdmin = isAdminEmail(user?.email);
  // Dono da conta (ADMIN sem ownerId) vê a aba "Equipe".
  const isAccountAdmin = ctx?.role === "ADMIN";

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <Sidebar isAdmin={isAdmin} isAccountAdmin={isAccountAdmin} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 2xl:max-w-[1600px]">
          {children}
        </div>
      </main>
    </div>
  );
}
