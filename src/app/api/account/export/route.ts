import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { exportAccountHeader, iterateUserLeads } from "@/server/services/user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exporta todos os dados da conta como download JSON (portabilidade LGPD).
 * Só o DONO (ADMIN): os dados (leads, campanhas, números) pertencem à conta dele;
 * a linha do operador não os contém.
 *
 * Monta o JSON em STREAM (ReadableStream): escreve o cabeçalho, depois os leads
 * lote a lote (`iterateUserLeads`). Assim uma conta com dezenas de milhares de
 * leads não segura a base inteira na memória — o pico é uma página de 1000.
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas o administrador da conta pode exportar os dados." },
      { status: 403 },
    );
  }

  let header;
  try {
    header = await exportAccountHeader(ctx.tenantUserId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao exportar os dados." },
      { status: 400 },
    );
  }

  const userId = ctx.tenantUserId;
  const filename = `disparador-ai-dados-${new Date().toISOString().slice(0, 10)}.json`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Cabeçalho (conta/campanhas/números) + abertura do array de leads.
        const head = {
          exportedAt: new Date().toISOString(),
          account: header.account,
          campaigns: header.campaigns,
          whatsAppNumbers: header.whatsAppNumbers,
        };
        const headJson = JSON.stringify(head);
        // Injeta a chave "leads" antes do fechamento "}" do cabeçalho.
        controller.enqueue(encoder.encode(headJson.slice(0, -1) + ',"leads":['));

        let first = true;
        for await (const batch of iterateUserLeads(userId)) {
          for (const lead of batch) {
            controller.enqueue(encoder.encode((first ? "" : ",") + JSON.stringify(lead)));
            first = false;
          }
        }
        controller.enqueue(encoder.encode("]}"));
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
