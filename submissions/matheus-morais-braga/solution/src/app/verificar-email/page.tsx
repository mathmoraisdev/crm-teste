"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/app/Logo";

function VerificarEmailStatus() {
  const params = useSearchParams();
  const erro = params.get("status") === "erro";

  return (
    <div className="w-full max-w-[400px]">
      <Link href="/" className="mb-9 inline-block">
        <Logo />
      </Link>

      {erro ? (
        <>
          <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">Link inválido</h1>
          <p className="mt-2 text-[15px] text-slate-500">
            Este link de confirmação é inválido ou já expirou. Você pode reenviar a verificação a partir
            da página de configurações da sua conta.
          </p>
          <div className="mt-7 flex flex-col gap-3">
            <Link
              href="/configuracoes"
              className="rounded-xl bg-brand-500 px-6 py-[15px] text-center text-[15.5px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-600"
            >
              Ir para configurações →
            </Link>
            <Link href="/leads" className="text-center font-bold text-brand-500 hover:underline">
              Voltar ao painel
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">E-mail confirmado</h1>
          <p className="mt-2 text-[15px] text-slate-500">
            Tudo certo! Seu e-mail foi confirmado com sucesso.
          </p>
          <Link
            href="/leads"
            className="mt-7 inline-block rounded-xl bg-brand-500 px-6 py-[15px] text-[15.5px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-600"
          >
            Ir para o painel →
          </Link>
        </>
      )}
    </div>
  );
}

export default function VerificarEmailPage() {
  return (
    <div data-theme="light" className="flex min-h-screen items-center justify-center bg-slate-50 text-ink px-6 py-12">
      <Suspense fallback={null}>
        <VerificarEmailStatus />
      </Suspense>
    </div>
  );
}
