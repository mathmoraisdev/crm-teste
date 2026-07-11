"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Pencil, Plus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { ProfessionalDTO, WorkingHoursDTO } from "@/server/services/professional.service";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/**
 * Cores disponíveis para o profissional (usadas como bolinha na agenda). Só
 * tokens de design — nada de hex fixo. O valor gravado é a chave (ex.: "brand").
 */
const COLORS: Array<{ key: string; label: string; dot: string }> = [
  { key: "slate", label: "Cinza", dot: "bg-slate-400" },
  { key: "brand", label: "Verde", dot: "bg-brand-500" },
  { key: "blue", label: "Azul", dot: "bg-info" },
  { key: "amber", label: "Âmbar", dot: "bg-warning" },
  { key: "red", label: "Vermelho", dot: "bg-danger" },
  { key: "violet", label: "Violeta", dot: "bg-accent" },
  { key: "teal", label: "Turquesa", dot: "bg-pro-teal" },
  { key: "pink", label: "Rosa", dot: "bg-pro-pink" },
  { key: "indigo", label: "Índigo", dot: "bg-pro-indigo" },
  { key: "orange", label: "Laranja", dot: "bg-pro-orange" },
];

function colorDot(color: string): string {
  return COLORS.find((c) => c.key === color)?.dot ?? "bg-slate-400";
}

/** Membro da equipe (subconjunto de MemberRow) para vincular a um profissional. */
interface MemberOption {
  id: string;
  name: string;
}

/** CRUD de profissionais (equipe que atende) + grade de expediente. Usado em /configuracoes. */
export function ProfessionalsSettings({ canEdit = true }: { canEdit?: boolean }) {
  const [items, setItems] = useState<ProfessionalDTO[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  // id do profissional em edição (reusa o mesmo form do "Adicionar" via PATCH); null = criando.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("slate");
  const [userId, setUserId] = useState<string>("");

  // Qual escopo de horário está aberto: "default" | professionalId | null.
  const [hoursOpen, setHoursOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/professionals", { cache: "no-store" });
      const data = await res.json();
      setItems((data.professionals as ProfessionalDTO[]) ?? []);
    } catch {
      // ignora
    } finally {
      setLoading(false);
    }
  }, []);

  // Vínculo a um membro é opcional: o endpoint /api/team só responde ao dono
  // (ADMIN); operadores recebem 403 e simplesmente não veem o seletor de membro.
  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/team", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setMembers(((data.members as MemberOption[]) ?? []).map((m) => ({ id: m.id, name: m.name })));
    } catch {
      // sem seletor de membro
    }
  }, []);

  useEffect(() => {
    load();
    loadMembers();
  }, [load, loadMembers]);

  function resetForm() {
    setAdding(false);
    setEditingId(null);
    setName("");
    setColor("slate");
    setUserId("");
    setError(null);
  }

  /** Abre o form já preenchido para editar um profissional existente (PATCH). */
  function startEdit(p: ProfessionalDTO) {
    setAdding(false);
    setEditingId(p.id);
    setName(p.name);
    setColor(p.color);
    setUserId(p.userId ?? "");
    setError(null);
  }

  async function save() {
    if (!name.trim()) {
      setError("Informe o nome.");
      return;
    }
    const payload = { name: name.trim(), color, userId: userId || null };
    // Mesmo form serve p/ criar (POST) e editar (PATCH no id).
    const res = editingId
      ? await fetch(`/api/professionals/${editingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/professionals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Falha ao salvar profissional");
      return;
    }
    resetForm();
    await load();
  }

  async function setActive(p: ProfessionalDTO, active: boolean) {
    // Desativar é SOFT (DELETE => active=false); reativar é PATCH.
    const res = active
      ? await fetch(`/api/professionals/${p.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ active: true }),
        })
      : await fetch(`/api/professionals/${p.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Falha ao atualizar profissional");
      return;
    }
    await load();
  }

  return (
    <Card>
      <CardHeader
        title="Profissionais"
        subtitle="Equipe que atende. Cada agendamento pode ser atribuído a um profissional, com sua própria cor e grade de expediente."
        action={
          canEdit &&
          !adding &&
          !editingId && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Adicionar
            </Button>
          )
        }
      />
      <div className="space-y-2 px-4 py-3">
        {error && (
          <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {(adding || editingId) && (
          <div className="space-y-2.5 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
            <p className="text-xs font-semibold text-ink">
              {editingId ? "Editar profissional" : "Novo profissional"}
            </p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Nome</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Ana Paula"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Cor</label>
                <select
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className={inputClass}
                >
                  {COLORS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {members.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Vincular a um usuário (opcional)
                </label>
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Sem vínculo</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={resetForm}>
                Cancelar
              </Button>
              <Button size="sm" onClick={save}>
                Salvar
              </Button>
            </div>
          </div>
        )}

        {/* Expediente padrão da conta (professionalId null) */}
        <div className="rounded-lg border border-line-default">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-semibold text-ink">Padrão da conta</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setHoursOpen(hoursOpen === "default" ? null : "default")}
            >
              <Clock size={14} /> Horários
            </Button>
          </div>
          {hoursOpen === "default" && (
            <WorkingHoursEditor scopeId="default" canEdit={canEdit} />
          )}
        </div>

        {loading && items.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">Carregando…</p>
        )}
        {!loading && items.length === 0 && !adding && (
          <p className="py-4 text-center text-sm text-slate-400">Nenhum profissional ainda.</p>
        )}

        {items.map((p) => (
          <div key={p.id} className="rounded-lg border border-line-default">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colorDot(p.color)}`} />
                <span className={`truncate text-sm font-semibold ${p.active ? "text-ink" : "text-slate-400"}`}>
                  {p.name}
                </span>
                {p.memberName && <Badge tone="slate">{p.memberName}</Badge>}
                {!p.active && <Badge tone="slate">Inativo</Badge>}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setHoursOpen(hoursOpen === p.id ? null : p.id)}
                >
                  <Clock size={14} /> Horários
                </Button>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>
                    <Pencil size={14} /> Editar
                  </Button>
                )}
                {canEdit &&
                  (p.active ? (
                    <Button size="sm" variant="ghost" onClick={() => setActive(p, false)}>
                      Desativar
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setActive(p, true)}>
                      Reativar
                    </Button>
                  ))}
              </div>
            </div>
            {hoursOpen === p.id && <WorkingHoursEditor scopeId={p.id} canEdit={canEdit} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Grade de expediente ──────────────────────────────────────────────────────

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

interface DayState {
  open: boolean;
  start: string; // HH:MM
  end: string;
  breakStart: string;
  breakEnd: string;
}

const DEFAULT_DAY: DayState = { open: false, start: "09:00", end: "18:00", breakStart: "", breakEnd: "" };

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const smallInput =
  "rounded-lg border border-slate-300 px-2 py-1 text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/**
 * Editor da grade semanal de um escopo (scopeId = "default" para a conta ou o
 * id do profissional). Faz REPLACE-ALL via PUT /api/professionals/{id}/working-hours.
 */
function WorkingHoursEditor({ scopeId, canEdit }: { scopeId: string; canEdit: boolean }) {
  const [days, setDays] = useState<DayState[]>(() => WEEKDAYS.map(() => ({ ...DEFAULT_DAY })));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/professionals/${scopeId}/working-hours`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const rows = (data.rows as WorkingHoursDTO[]) ?? [];
      const next = WEEKDAYS.map(() => ({ ...DEFAULT_DAY }));
      for (const r of rows) {
        if (r.weekday < 0 || r.weekday > 6) continue;
        next[r.weekday] = {
          open: true,
          start: minutesToHHMM(r.startMinute),
          end: minutesToHHMM(r.endMinute),
          breakStart: r.breakStart != null ? minutesToHHMM(r.breakStart) : "",
          breakEnd: r.breakEnd != null ? minutesToHHMM(r.breakEnd) : "",
        };
      }
      setDays(next);
    } catch {
      // mantém grade vazia
    } finally {
      setLoading(false);
    }
  }, [scopeId]);

  useEffect(() => {
    load();
  }, [load]);

  function patchDay(idx: number, patch: Partial<DayState>) {
    setSaved(false);
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  async function save() {
    setError(null);
    const rows: Array<{
      weekday: number;
      startMinute: number;
      endMinute: number;
      breakStart: number | null;
      breakEnd: number | null;
    }> = [];
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (!d.open) continue;
      const start = hhmmToMinutes(d.start);
      const end = hhmmToMinutes(d.end);
      if (start == null || end == null) {
        setError(`${WEEKDAYS[i]}: horário inválido.`);
        return;
      }
      if (start >= end) {
        setError(`${WEEKDAYS[i]}: início deve ser antes do fim.`);
        return;
      }
      // Intervalo só se ambos preenchidos.
      const bs = d.breakStart ? hhmmToMinutes(d.breakStart) : null;
      const be = d.breakEnd ? hhmmToMinutes(d.breakEnd) : null;
      if ((d.breakStart && bs == null) || (d.breakEnd && be == null)) {
        setError(`${WEEKDAYS[i]}: intervalo inválido.`);
        return;
      }
      rows.push({ weekday: i, startMinute: start, endMinute: end, breakStart: bs, breakEnd: be });
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/professionals/${scopeId}/working-hours`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Falha ao salvar horários");
        return;
      }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="px-3 py-3 text-center text-xs text-slate-400">Carregando horários…</p>;
  }

  return (
    <div className="space-y-2 border-t border-line-default px-3 py-3">
      {error && (
        <p className="rounded-md bg-danger-surface px-3 py-2 text-xs text-danger">{error}</p>
      )}
      <div className="space-y-1.5">
        {days.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <label className="flex w-16 shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={d.open}
                disabled={!canEdit}
                onChange={(e) => patchDay(i, { open: e.target.checked })}
                className="accent-brand-500"
              />
              {WEEKDAYS[i]}
            </label>
            {d.open ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="time"
                  value={d.start}
                  disabled={!canEdit}
                  onChange={(e) => patchDay(i, { start: e.target.value })}
                  className={smallInput}
                />
                <span className="text-xs text-slate-400">às</span>
                <input
                  type="time"
                  value={d.end}
                  disabled={!canEdit}
                  onChange={(e) => patchDay(i, { end: e.target.value })}
                  className={smallInput}
                />
                <span className="text-xs text-slate-400">intervalo</span>
                <input
                  type="time"
                  value={d.breakStart}
                  disabled={!canEdit}
                  onChange={(e) => patchDay(i, { breakStart: e.target.value })}
                  className={smallInput}
                />
                <span className="text-xs text-slate-400">–</span>
                <input
                  type="time"
                  value={d.breakEnd}
                  disabled={!canEdit}
                  onChange={(e) => patchDay(i, { breakEnd: e.target.value })}
                  className={smallInput}
                />
              </div>
            ) : (
              <span className="text-xs text-slate-400">Fechado</span>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-xs text-brand-600">Salvo.</span>}
          <Button size="sm" onClick={save} loading={saving}>
            Salvar horários
          </Button>
        </div>
      )}
    </div>
  );
}
