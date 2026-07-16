"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  BUSINESS_TEMPLATES,
  CATEGORY_LABEL,
  getTemplate,
  catalogSeedItems,
  type BusinessCategory,
} from "@/lib/business-templates";
import { presetForCategory } from "@/lib/theme/presets";

/** Categorias que realmente têm modelos, na ordem do CATEGORY_LABEL. */
function usedCategories(): BusinessCategory[] {
  const present = new Set(BUSINESS_TEMPLATES.map((t) => t.category));
  return (Object.keys(CATEGORY_LABEL) as BusinessCategory[]).filter((c) => present.has(c));
}

/** Número da conta, no formato que o GET /api/numbers devolve (subconjunto usado aqui). */
interface NumberOption {
  id: string;
  label: string;
  phone: string;
  displayName: string | null;
  persona: string | null;
  knowledgeBase: string | null;
  businessHours: string | null;
  customInstructions: string | null;
}

/** Resultado do POST /api/onboarding/apply-vertical (espelha VerticalResult). */
interface VerticalResult {
  plan: {
    setRamo: boolean;
    applyTheme: boolean;
    themePresetId: string | null;
    seedFields: boolean;
    seedCatalog: boolean;
    setLabels: boolean;
    applyAttendance: boolean;
    seedOffers: boolean;
  };
  fields?: { created: number; skipped: number };
  offers?: { created: number; skipped: number };
  catalogSeeded?: number;
  errors: string[];
}

const selectClass =
  "w-full rounded-lg border border-line-default bg-inset px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50";

/** Rótulo amigável do número (nome do perfil > apelido > telefone). */
function numberLabel(n: NumberOption): string {
  return n.displayName?.trim() || n.label?.trim() || n.phone;
}

/** O número já tem algum texto de atendimento escrito? */
function numberHasText(n: NumberOption): boolean {
  return [n.persona, n.knowledgeBase, n.businessHours, n.customInstructions].some(
    (v) => (v ?? "").trim().length > 0,
  );
}

/**
 * Wizard de 3 passos que aplica um ramo de negócio de uma vez: escolhe o ramo,
 * revisa o que será semeado (tema, campos, catálogo, funil e — opcionalmente —
 * o atendimento de um número) e aplica via POST /api/onboarding/apply-vertical.
 */
export function VerticalOnboardingWizard({
  initial,
  canEdit = true,
}: {
  initial?: string | null;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const categories = useMemo(usedCategories, []);
  const initialTpl = initial ? getTemplate(initial) : undefined;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [cat, setCat] = useState<BusinessCategory | "">(initialTpl?.category ?? "");
  const [tplId, setTplId] = useState(initialTpl?.id ?? "");
  const [applyTheme, setApplyTheme] = useState(true);
  const [numberId, setNumberId] = useState("");
  const [overwriteText, setOverwriteText] = useState(false);

  const [numbers, setNumbers] = useState<NumberOption[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerticalResult | null>(null);

  // Carrega os números da conta para o seletor do passo 2 (mesmo endpoint do painel de números).
  useEffect(() => {
    if (!canEdit) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/numbers");
        if (!r.ok) return;
        const d = await r.json().catch(() => null);
        if (alive && d?.numbers) setNumbers(d.numbers as NumberOption[]);
      } catch {
        // silencioso — o seletor de número é opcional
      }
    })();
    return () => {
      alive = false;
    };
  }, [canEdit]);

  const options = useMemo(
    () => (cat ? BUSINESS_TEMPLATES.filter((t) => t.category === cat) : []),
    [cat],
  );
  const selected = options.find((t) => t.id === tplId) ?? null;

  // Preset dedicado da categoria (não o fallback verde), p/ oferecer as cores do ramo.
  const themePreset = useMemo(() => {
    if (!cat) return null;
    const p = presetForCategory(cat);
    return p.category === cat ? p : null;
  }, [cat]);

  const fieldsCount = selected?.customFieldsPreset?.length ?? 0;
  const labelsCount = selected?.pipelineLabels ? Object.keys(selected.pipelineLabels).length : 0;
  const offersCount = selected?.suggestedOffers?.length ?? 0;
  const catalogCount = useMemo(
    () => (selected ? catalogSeedItems(selected).length : 0),
    [selected],
  );

  const selectedNumber = numbers.find((n) => n.id === numberId) ?? null;
  const showOverwrite = !!selectedNumber && numberHasText(selectedNumber);

  async function apply() {
    if (!selected) return;
    setApplying(true);
    setError(null);
    try {
      const r = await fetch("/api/onboarding/apply-vertical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selected.id,
          numberId: numberId || null,
          applyTheme,
          overwriteText,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Erro ao aplicar o ramo.");
      setResult(d as VerticalResult);
      setStep(3);
      // Atualiza as seções da página (ramo, tema, campos, funil) sem recarga cheia.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao aplicar o ramo.");
    } finally {
      setApplying(false);
    }
  }

  function restart() {
    setResult(null);
    setError(null);
    setStep(1);
  }

  if (!canEdit) {
    return (
      <div id="configuracao-rapida-ramo">
        <Card>
          <CardHeader
            title="Configuração rápida do ramo"
            subtitle="Aplique o pacote completo do seu ramo (tema, campos, catálogo e atendimento) de uma vez."
          />
          <div className="px-4 py-3">
            <p className="text-sm text-slate-500">
              Apenas o administrador da conta pode aplicar a configuração de um ramo.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div id="configuracao-rapida-ramo">
      <Card>
      <CardHeader
        title="Configuração rápida do ramo"
        subtitle="Aplique o pacote completo do seu ramo (tema, campos, catálogo e atendimento) de uma vez."
      />
      <div className="px-4 py-3">
        {/* Trilha dos 3 passos */}
        <ol className="mb-4 flex items-center gap-2 text-xs font-semibold">
          {(["Escolher ramo", "Revisar", "Aplicar"] as const).map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            const active = step === n;
            const done = step > n;
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={
                    active
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white"
                      : done
                        ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                        : "flex h-5 w-5 items-center justify-center rounded-full bg-inset text-slate-500"
                  }
                >
                  {n}
                </span>
                <span className={active ? "text-ink" : "text-slate-500"}>{label}</span>
                {n < 3 && <span className="text-line-default">›</span>}
              </li>
            );
          })}
        </ol>

        {/* PASSO 1 — Escolher ramo */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                value={cat}
                onChange={(e) => {
                  setCat(e.target.value as BusinessCategory | "");
                  setTplId("");
                }}
                className={selectClass}
              >
                <option value="">Categoria…</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
              <select
                value={tplId}
                onChange={(e) => setTplId(e.target.value)}
                disabled={!cat}
                className={selectClass}
              >
                <option value="">{cat ? "Ramo…" : "Escolha a categoria"}</option>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            {selected && <p className="text-sm text-slate-500">{selected.blurb}</p>}
            <div className="flex justify-end">
              <Button size="sm" disabled={!selected} onClick={() => setStep(2)}>
                Continuar
              </Button>
            </div>
          </div>
        )}

        {/* PASSO 2 — Revisar */}
        {step === 2 && selected && (
          <div className="space-y-3">
            <div className="rounded-lg border border-line bg-surface px-3 py-3">
              <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                O que será aplicado em <span className="text-ink">{selected.label}</span>:
              </p>
              <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
                <li className="flex items-center gap-2">
                  {themePreset ? (
                    <>
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-black/5"
                        style={{
                          background: `rgb(${themePreset.palette["500"].replaceAll(" ", ",")})`,
                        }}
                      />
                      Tema: <span className="text-ink">{themePreset.label}</span>
                      {!applyTheme && <span className="text-slate-400">(desativado)</span>}
                    </>
                  ) : (
                    <span className="text-slate-400">Tema: sem cor dedicada para este ramo</span>
                  )}
                </li>
                <li>
                  Campos personalizados:{" "}
                  <span className="text-ink">
                    {fieldsCount > 0 ? `${fieldsCount} campo(s)` : "nenhum"}
                  </span>
                </li>
                <li>
                  Catálogo:{" "}
                  <span className="text-ink">
                    {catalogCount > 0
                      ? `${catalogCount} item(ns), se ainda estiver vazio`
                      : "nenhum item sugerido"}
                  </span>
                </li>
                <li>
                  Funil:{" "}
                  <span className="text-ink">
                    {labelsCount > 0 ? `renomeia ${labelsCount} etapa(s)` : "sem alterações"}
                  </span>
                </li>
              </ul>
            </div>

            {themePreset && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={applyTheme}
                  onChange={(e) => setApplyTheme(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-line-default text-brand-500 focus:ring-brand-500/30"
                />
                Aplicar também as cores deste ramo
              </label>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Aplicar atendimento e ofertas a:
              </label>
              <select
                value={numberId}
                onChange={(e) => {
                  setNumberId(e.target.value);
                  setOverwriteText(false);
                }}
                className={selectClass}
              >
                <option value="">Nenhum número (só a conta)</option>
                {numbers.map((n) => (
                  <option key={n.id} value={n.id}>
                    {numberLabel(n)}
                  </option>
                ))}
              </select>
              {numberId && offersCount > 0 && (
                <p className="text-xs text-slate-500">
                  Inclui {offersCount} oferta(s) sugerida(s) para este número (se o plano permitir vendas).
                </p>
              )}
              {showOverwrite && (
                <label className="flex items-start gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={overwriteText}
                    onChange={(e) => setOverwriteText(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-line-default text-brand-500 focus:ring-brand-500/30"
                  />
                  <span>
                    Substituir persona, base de conhecimento e horário já escritos neste número.
                    Se desmarcado, mantém o que você escreveu e só preenche os campos vazios.
                  </span>
                </label>
              )}
            </div>

            {error && (
              <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
            )}

            <div className="flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button size="sm" loading={applying} onClick={apply}>
                Aplicar ramo
              </Button>
            </div>
          </div>
        )}

        {/* PASSO 3 — Resultado */}
        {step === 3 && result && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-brand-600">Ramo aplicado ✓</p>
            <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
              <li>
                Ramo salvo e{" "}
                {result.plan.applyTheme ? "tema aplicado" : "tema não alterado"}.
              </li>
              {result.fields && (
                <li>
                  Campos: <span className="text-ink">{result.fields.created} criado(s)</span>,{" "}
                  {result.fields.skipped} já existiam.
                </li>
              )}
              {result.catalogSeeded !== undefined && (
                <li>
                  Catálogo: <span className="text-ink">{result.catalogSeeded} item(ns)</span> semeado(s).
                </li>
              )}
              {result.plan.setLabels && <li>Funil renomeado conforme o ramo.</li>}
              {result.plan.applyAttendance && <li>Atendimento aplicado ao número escolhido.</li>}
              {result.offers && (
                <li>
                  Ofertas: <span className="text-ink">{result.offers.created} criada(s)</span>,{" "}
                  {result.offers.skipped} já existiam.
                </li>
              )}
            </ul>

            {result.errors.length > 0 && (
              <div className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">
                <p className="font-semibold">Algumas etapas não concluíram:</p>
                <ul className="mt-1 list-disc pl-4">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs">
              <Link
                href="/catalogo"
                className="rounded-lg border border-line-default px-3 py-1.5 font-semibold text-ink hover:border-brand-400 hover:bg-inset"
              >
                Ver catálogo
              </Link>
              <Link
                href="/configuracoes"
                className="rounded-lg border border-line-default px-3 py-1.5 font-semibold text-ink hover:border-brand-400 hover:bg-inset"
              >
                Ver campos
              </Link>
              <Link
                href="/agenda"
                className="rounded-lg border border-line-default px-3 py-1.5 font-semibold text-ink hover:border-brand-400 hover:bg-inset"
              >
                Ver agenda
              </Link>
            </div>

            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={restart}>
                Aplicar outro ramo
              </Button>
            </div>
          </div>
        )}
      </div>
      </Card>
    </div>
  );
}
