import { Sidebar } from "@/components/app/Sidebar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
