import { WhatsAppNumbersPanel } from "@/components/WhatsAppNumbersPanel";

export const dynamic = "force-dynamic";

export default function EmpresasPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Empresas &amp; Atendimentos</h1>
        <p className="text-sm text-slate-500">
          Cada número conectado é uma empresa. Configure a persona, a base de conhecimento e o que a IA pode fazer.
        </p>
      </header>
      <WhatsAppNumbersPanel />
    </div>
  );
}
