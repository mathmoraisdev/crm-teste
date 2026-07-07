// src/app/api/admin/accounts/[id]/route.ts
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { getUserById, deleteAccount } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@/server/db/client";

export const runtime = "nodejs";

/**
 * Exclui uma conta inteira (dono + operadores + dados) a partir do painel admin.
 * Reusa deleteAccount: grava o aviso de EXCLUSAO e apaga com cascade do schema.
 *
 * Restrições: só admin da plataforma; não deixa excluir uma conta admin (evita
 * derrubar a própria conta de administração por engano).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  const me = userId ? await getUserById(userId) : null;
  if (!me || !isAdminEmail(me.email)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const { id } = await params;

  const target = await prisma.user.findUnique({
    where: { id },
    select: { email: true, ownerId: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }
  if (target.ownerId !== null) {
    // Operadores são removidos em /equipe, não aqui (só contas/donos).
    return NextResponse.json({ error: "Só é possível excluir contas (donos)." }, { status: 400 });
  }
  if (isAdminEmail(target.email)) {
    return NextResponse.json(
      { error: "Conta admin não pode ser excluída." },
      { status: 400 },
    );
  }

  try {
    await deleteAccount(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao excluir a conta." },
      { status: 400 },
    );
  }
}
