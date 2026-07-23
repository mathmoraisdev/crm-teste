import { MapPin } from "lucide-react";
import { googleMapsSearchUrl } from "@/lib/maps";

/**
 * Bloco de endereço do estabelecimento para as páginas/telas PÚBLICAS (retirada
 * do cardápio, acompanhamento e agendamento presencial). Presentacional e sem
 * hooks — serve em Server e Client Components. Renderiza `null` sem endereço, para
 * o chamador poder inserir sempre sem checar. Usa tokens de tema (claro/escuro).
 */
export function AddressBlock({
  address,
  label = "Endereço",
}: {
  address: string | null | undefined;
  label?: string;
}) {
  const value = address?.trim();
  if (!value) return null;
  return (
    <div className="rounded-lg bg-inset p-3">
      <div className="flex items-start gap-2">
        <MapPin size={16} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="text-sm font-medium text-ink">{value}</p>
          <a
            href={googleMapsSearchUrl(value)}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-block text-xs font-medium text-brand-600 underline underline-offset-2 dark:text-brand-400"
          >
            Como chegar
          </a>
        </div>
      </div>
    </div>
  );
}
