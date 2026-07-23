export type FieldChange = { from: unknown; to: unknown };
export type Diff = Record<string, FieldChange>;

/**
 * Diff raso: só os campos de `fields` que EXISTEM no patch (`after`) e diferem do `before`.
 * Campo ausente no patch = não mudou (undefined não conta). Comparação com !== (valores primitivos).
 */
export function computeDiff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): Diff {
  const diff: Diff = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(after, f) && after[f] !== before[f]) {
      diff[f as string] = { from: before[f], to: after[f] };
    }
  }
  return diff;
}
