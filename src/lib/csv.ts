import Papa from "papaparse";
import { normalizePhone } from "./phone";

export interface ParsedLeadRow {
  name: string;
  phone: string; // E.164 normalizado
}

export interface CsvParseResult {
  valid: ParsedLeadRow[];
  invalid: { line: number; reason: string; raw: Record<string, string> }[];
}

/**
 * Faz o parse de um CSV "nome,telefone" (cabeçalho flexível: aceita
 * nome/name e telefone/phone/celular). Normaliza o telefone para E.164 e
 * separa linhas válidas de inválidas, sem lançar exceção.
 */
export function parseLeadsCsv(content: string): CsvParseResult {
  const result: CsvParseResult = { valid: [], invalid: [] };

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  parsed.data.forEach((row, idx) => {
    const line = idx + 2; // +1 cabeçalho, +1 base-1
    const name = (row["nome"] ?? row["name"] ?? "").trim();
    const rawPhone = (row["telefone"] ?? row["phone"] ?? row["celular"] ?? "").trim();

    if (!name) {
      result.invalid.push({ line, reason: "Nome vazio", raw: row });
      return;
    }
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      result.invalid.push({
        line,
        reason: `Telefone inválido: "${rawPhone}"`,
        raw: row,
      });
      return;
    }
    result.valid.push({ name, phone });
  });

  return result;
}
