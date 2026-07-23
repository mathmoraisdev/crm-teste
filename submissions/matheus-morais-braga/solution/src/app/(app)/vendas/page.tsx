import { redirect } from "next/navigation";

// Bookmarks antigos: o módulo Vendas virou Caixa. Redireciona pra rota nova.
export default function VendasRedirect() {
  redirect("/caixa");
}
