"use client";

import { useRef, useState } from "react";
import { Upload, FileDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ImportResult } from "@/server/services/lead.service";

export function CsvUpload({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: text,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha na importação");
      setResult(data as ImportResult);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao importar");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Envie um arquivo CSV com as colunas <code>nome,telefone</code>. Os
        telefones são normalizados para E.164 e duplicados (por telefone) são
        ignorados.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <Button onClick={() => inputRef.current?.click()} loading={loading}>
          <Upload size={16} /> Selecionar CSV
        </Button>
        <a
          href="/sample-leads.csv"
          download
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <FileDown size={16} /> Baixar exemplo
        </a>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {result && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p>
            <strong>{result.created}</strong> leads criados ·{" "}
            <strong>{result.skippedDuplicates}</strong> duplicados ignorados
            {result.invalid.length > 0 && (
              <>
                {" "}
                · <strong>{result.invalid.length}</strong> linhas inválidas
              </>
            )}
          </p>
          {result.invalid.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-red-600">
              {result.invalid.slice(0, 5).map((i) => (
                <li key={i.line}>
                  Linha {i.line}: {i.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
