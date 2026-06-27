import { Sidebar } from "@/components/app/Sidebar";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getCurrentUserId();
  const user = userId ? await getUserById(userId) : null;
  const isAdmin = isAdminEmail(user?.email);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar isAdmin={isAdmin} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
