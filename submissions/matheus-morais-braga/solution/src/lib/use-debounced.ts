import { useEffect, useState } from "react";

/** Atrasa a propagação de `value` em `ms` — usado p/ não disparar fetch a cada tecla. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
