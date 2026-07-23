import { SalesPriorityDashboard } from "@/components/SalesPriorityDashboard";

/**
 * /leads/prioridade — Fila de ligações do vendedor.
 *
 * View dedicada: mostra leads ordenados por score da IA (desc) com a
 * justificativa gerada. O vendedor abre, vê quem ligar primeiro e age.
 * Não mistura com o kanban/tabela genérica de gestão de funil.
 */
export default function LeadsPriorityPage() {
  return <SalesPriorityDashboard />;
}
