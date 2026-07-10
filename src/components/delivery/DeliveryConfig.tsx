"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";
import { DELIVERY_ADDON_PRICE_CENTS } from "@/lib/plans";
import type { DeliveryHours } from "@/server/services/delivery-settings.service";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-inset dark:text-ink";
const numClass =
  "w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-inset dark:text-ink";

export interface DeliveryZoneRow {
  id: string;
  name: string;
  feeCents: number;
  minOrderCents: number | null;
  active: boolean;
}

export interface DeliverySettingsInitial {
  menuEnabled: boolean;
  publicSlug: string | null;
  publicUrl: string | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  payOnlineEnabled: boolean;
  payOnDeliveryEnabled: boolean;
  minOrderCents: number;
  defaultPrepMinutes: number;
  hours: DeliveryHours | null;
}

const DAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Carrega/normaliza o horário p/ o editor (garante um slot por dia). */
function loadHours(hours: DeliveryHours | null): Record<string, { open: string; close: string; closed: boolean }> {
  const out: Record<string, { open: string; close: string; closed: boolean }> = {};
  for (let d = 0; d <= 6; d++) {
    const w = (hours?.[String(d)] ?? [])[0];
    out[String(d)] = { open: w?.open ?? "18:00", close: w?.close ?? "23:00", closed: !w };
  }
  return out;
}

function serializeHours(rows: Record<string, { open: string; close: string; closed: boolean }>): DeliveryHours {
  const out: DeliveryHours = {};
  for (let d = 0; d <= 6; d++) {
    const r = rows[String(d)];
    if (!r.closed && r.open && r.close) out[String(d)] = [{ open: r.open, close: r.close }];
  }
  return out;
}

/**
 * Ordem inicial das categorias na tela: mantém a ordem salva (só as que ainda
 * existem no cardápio) e acrescenta as novas ao fim, em ordem alfabética.
 */
function mergeCategoryOrder(saved: string[], present: string[]): string[] {
  const presentSet = new Set(present);
  const kept = saved.filter((c) => presentSet.has(c));
  const keptSet = new Set(kept);
  const rest = present.filter((c) => !keptSet.has(c)).sort((a, b) => a.localeCompare(b));
  return [...kept, ...rest];
}

/**
 * Configuração do cardápio online: publica o link público, liga entrega/retirada,
 * formas de pagamento, pedido mínimo, tempo de preparo, zonas de entrega (bairros/taxas)
 * e horário de funcionamento. Salva em /api/delivery/*.
 */
export function DeliveryConfig({
  initial,
  initialZones,
  canEdit = true,
  entitled = true,
  menuCategories = [],
  initialCategoryOrder = [],
}: {
  initial: DeliverySettingsInitial;
  initialZones: DeliveryZoneRow[];
  canEdit?: boolean;
  /** Conta tem o add-on de Delivery ativo? Sem ele, não dá pra publicar o cardápio. */
  entitled?: boolean;
  /** Categorias (menuCategory) em uso no cardápio hoje. */
  menuCategories?: string[];
  /** Ordem manual salva das categorias. */
  initialCategoryOrder?: string[];
}) {
  const [menuEnabled, setMenuEnabled] = useState(initial.menuEnabled);
  const [slug, setSlug] = useState(initial.publicSlug ?? "");
  const [publicUrl, setPublicUrl] = useState(initial.publicUrl);
  const [deliveryEnabled, setDeliveryEnabled] = useState(initial.deliveryEnabled);
  const [pickupEnabled, setPickupEnabled] = useState(initial.pickupEnabled);
  const [payOnline, setPayOnline] = useState(initial.payOnlineEnabled);
  const [payOnDelivery, setPayOnDelivery] = useState(initial.payOnDeliveryEnabled);
  const [minOrder, setMinOrder] = useState(formatCentsBRL(initial.minOrderCents));
  const [prepMin, setPrepMin] = useState(String(initial.defaultPrepMinutes));
  const [hoursRows, setHoursRows] = useState(() => loadHours(initial.hours));
  const [catOrder, setCatOrder] = useState<string[]>(() =>
    mergeCategoryOrder(initialCategoryOrder, menuCategories),
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zonas (editor de sub-lista)
  const [zones, setZones] = useState<DeliveryZoneRow[]>(initialZones);
  const [newName, setNewName] = useState("");
  const [newFee, setNewFee] = useState("");
  const [newMin, setNewMin] = useState("");
  const [zoneBusy, setZoneBusy] = useState<string | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);

  /** Move a categoria da posição `i` uma casa pra cima (-1) ou pra baixo (+1). */
  function moveCategory(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= catOrder.length) return;
    setCatOrder((order) => {
      const next = [...order];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSaved(false);
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Não foi possível copiar. Copie o link manualmente.");
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const minCents = parseBRLToCents(minOrder);
    if (minCents == null) {
      setError("Pedido mínimo inválido (use o formato 0,00).");
      setSaving(false);
      return;
    }
    try {
      const body: Record<string, unknown> = {
        menuEnabled,
        deliveryEnabled,
        pickupEnabled,
        payOnlineEnabled: payOnline,
        payOnDeliveryEnabled: payOnDelivery,
        minOrderCents: minCents,
        defaultPrepMinutes: Number(prepMin.trim()) || 0,
        hours: serializeHours(hoursRows),
        categoryOrder: catOrder,
      };
      if (slug.trim()) body.publicSlug = slug.trim();
      const res = await fetch("/api/delivery/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar");
      setMenuEnabled(Boolean(data.menuEnabled));
      setSlug(data.publicSlug ?? "");
      setPublicUrl(data.publicUrl ?? null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function addZone() {
    setZoneError(null);
    const name = newName.trim();
    if (!name) {
      setZoneError("Informe o nome do bairro.");
      return;
    }
    const feeCents = parseBRLToCents(newFee) ?? 0;
    const minCents = newMin.trim() ? parseBRLToCents(newMin) : null;
    if (newMin.trim() && minCents == null) {
      setZoneError("Pedido mínimo inválido.");
      return;
    }
    setZoneBusy("__new");
    try {
      const res = await fetch("/api/delivery/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, feeCents, minOrderCents: minCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao criar zona");
      setZones((z) => [...z, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setNewFee("");
      setNewMin("");
    } catch (e) {
      setZoneError(e instanceof Error ? e.message : "Erro ao criar zona");
    } finally {
      setZoneBusy(null);
    }
  }

  async function toggleZoneActive(z: DeliveryZoneRow, active: boolean) {
    setZoneBusy(z.id);
    setZoneError(null);
    try {
      const res = await fetch(`/api/delivery/zones/${z.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao atualizar zona");
      setZones((zs) => zs.map((x) => (x.id === z.id ? data : x)));
    } catch (e) {
      setZoneError(e instanceof Error ? e.message : "Erro ao atualizar zona");
    } finally {
      setZoneBusy(null);
    }
  }

  async function removeZone(z: DeliveryZoneRow) {
    setZoneBusy(z.id);
    setZoneError(null);
    try {
      const res = await fetch(`/api/delivery/zones/${z.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Falha ao excluir zona");
      }
      setZones((zs) => zs.filter((x) => x.id !== z.id));
    } catch (e) {
      setZoneError(e instanceof Error ? e.message : "Erro ao excluir zona");
    } finally {
      setZoneBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Cardápio & Delivery"
        subtitle="Publique seu cardápio em um link público (sem login) com carrinho, entrega/retirada, taxa por bairro e Pix online."
      />
      <div className="space-y-5 px-4 py-3">
        {/* Add-on pago: sem ele, o cardápio não pode ser publicado. */}
        {!entitled && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
              Add-on de Delivery — {formatCentsBRL(DELIVERY_ADDON_PRICE_CENTS)}/mês
            </p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400/80">
              Publique o cardápio, receba pedidos de entrega/retirada e cobre Pix online. Fale com o
              suporte para ativar — você já pode deixar tudo configurado aqui enquanto isso.
            </p>
          </div>
        )}

        {/* Publicar cardápio */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={menuEnabled}
            disabled={!canEdit || !entitled}
            onChange={(e) => {
              setMenuEnabled(e.target.checked);
              setSaved(false);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Publicar cardápio online</span>
            <span className="block text-xs text-slate-500">
              {entitled
                ? "Enquanto desligado, o link responde como inexistente (404)."
                : "Requer o add-on de Delivery para publicar."}
            </span>
          </span>
        </label>

        {/* Slug + link */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Endereço do link</label>
          <input
            value={slug}
            disabled={!canEdit}
            onChange={(e) => {
              setSlug(e.target.value);
              setSaved(false);
            }}
            placeholder="ex.: pizzaria-da-ana"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Mesmo endereço do agendamento. O cardápio fica em <code>/cardapio/&lt;endereço&gt;</code>.
          </span>
          {publicUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a
                href={publicUrl.replace("/agendar/", "/cardapio/")}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm text-brand-600 underline underline-offset-2"
              >
                {publicUrl.replace("/agendar/", "/cardapio/")}
              </a>
              <Button size="sm" variant="secondary" onClick={copyLink}>
                {copied ? "Copiado ✓" : "Copiar"}
              </Button>
            </div>
          )}
        </div>

        {/* Ordem das categorias (tópicos) no cardápio */}
        {catOrder.length >= 2 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Ordem das categorias no cardápio
            </label>
            <div className="space-y-2">
              {catOrder.map((cat, i) => (
                <div
                  key={cat}
                  className="flex items-center gap-2 rounded-lg border border-line bg-inset px-3 py-2"
                >
                  <span className="w-6 text-xs tabular-nums text-slate-400">{i + 1}.</span>
                  <span className="flex-1 truncate text-sm font-medium text-ink">{cat}</span>
                  {canEdit && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={i === 0}
                        onClick={() => moveCategory(i, -1)}
                        aria-label={`Mover ${cat} para cima`}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={i === catOrder.length - 1}
                        onClick={() => moveCategory(i, 1)}
                        aria-label={`Mover ${cat} para baixo`}
                      >
                        ↓
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <span className="mt-1 block text-xs text-slate-500">
              A ordem aqui é a ordem dos tópicos no cardápio. &quot;Outros&quot; (sem categoria)
              aparece sempre por último. Salve para aplicar.
            </span>
          </div>
        )}

        {/* Toggles de modalidade/pagamento */}
        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleRow
            label="Aceitar entrega"
            checked={deliveryEnabled}
            disabled={!canEdit}
            onChange={(v) => {
              setDeliveryEnabled(v);
              setSaved(false);
            }}
          />
          <ToggleRow
            label="Aceitar retirada"
            checked={pickupEnabled}
            disabled={!canEdit}
            onChange={(v) => {
              setPickupEnabled(v);
              setSaved(false);
            }}
          />
          <ToggleRow
            label="Pagar online (Pix)"
            checked={payOnline}
            disabled={!canEdit}
            onChange={(v) => {
              setPayOnline(v);
              setSaved(false);
            }}
          />
          <ToggleRow
            label="Pagar na entrega"
            checked={payOnDelivery}
            disabled={!canEdit}
            onChange={(v) => {
              setPayOnDelivery(v);
              setSaved(false);
            }}
          />
        </div>

        {/* Pedido mínimo + tempo de preparo */}
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Pedido mínimo (R$)</label>
            <input
              value={minOrder}
              disabled={!canEdit}
              onChange={(e) => {
                setMinOrder(e.target.value);
                setSaved(false);
              }}
              placeholder="0,00"
              className={numClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Preparo padrão (min)</label>
            <input
              type="number"
              min={0}
              value={prepMin}
              disabled={!canEdit}
              onChange={(e) => {
                setPrepMin(e.target.value);
                setSaved(false);
              }}
              className={numClass}
            />
          </div>
        </div>

        {/* Horário de funcionamento */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Horário de funcionamento</label>
          <div className="space-y-2">
            {DAY_LABELS.map((label, d) => {
              const r = hoursRows[String(d)];
              return (
                <div key={d} className="flex flex-wrap items-center gap-2">
                  <span className="w-20 text-sm text-ink">{label}</span>
                  <label className="flex items-center gap-1 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={!r.closed}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setHoursRows((h) => ({ ...h, [String(d)]: { ...h[String(d)], closed: !e.target.checked } }));
                        setSaved(false);
                      }}
                    />
                    Aberto
                  </label>
                  <input
                    type="time"
                    value={r.open}
                    disabled={!canEdit || r.closed}
                    onChange={(e) => {
                      setHoursRows((h) => ({ ...h, [String(d)]: { ...h[String(d)], open: e.target.value } }));
                      setSaved(false);
                    }}
                    className={numClass}
                  />
                  <span className="text-xs text-slate-500">às</span>
                  <input
                    type="time"
                    value={r.close}
                    disabled={!canEdit || r.closed}
                    onChange={(e) => {
                      setHoursRows((h) => ({ ...h, [String(d)]: { ...h[String(d)], close: e.target.value } }));
                      setSaved(false);
                    }}
                    className={numClass}
                  />
                </div>
              );
            })}
          </div>
          <span className="mt-1 block text-xs text-slate-500">
            Sem horário configurado, a loja aparece sempre aberta.
          </span>
        </div>

        {error && <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

        {canEdit && (
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-brand-600">Salvo ✓</span>}
            <Button size="sm" onClick={save} loading={saving}>
              Salvar delivery
            </Button>
          </div>
        )}

        {/* Zonas de entrega */}
        <div className="border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-ink">Bairros / zonas de entrega</h4>
            <span className="text-xs text-slate-500">{zones.length} cadastrada(s)</span>
          </div>

          <div className="space-y-2">
            {zones.map((z) => (
              <div
                key={z.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-inset px-3 py-2"
              >
                <span className="flex-1 text-sm font-medium text-ink">{z.name}</span>
                <span className="text-sm text-slate-600">{formatCentsBRL(z.feeCents)}</span>
                {z.minOrderCents != null && (
                  <span className="text-xs text-slate-500">mín. {formatCentsBRL(z.minOrderCents)}</span>
                )}
                {canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={zoneBusy === z.id}
                      onClick={() => toggleZoneActive(z, !z.active)}
                    >
                      {z.active ? "Desativar" : "Ativar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={zoneBusy === z.id}
                      onClick={() => removeZone(z)}
                    >
                      Excluir
                    </Button>
                  </>
                )}
              </div>
            ))}
            {zones.length === 0 && (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-slate-500">
                Nenhuma zona cadastrada. Sem zonas, a entrega fica sem taxa (ou bloqueie só a retirada).
              </p>
            )}
          </div>

          {canEdit && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Bairro</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex.: Centro"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Taxa (R$)</label>
                <input
                  value={newFee}
                  onChange={(e) => setNewFee(e.target.value)}
                  placeholder="0,00"
                  className={numClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Mín. (R$)</label>
                <input
                  value={newMin}
                  onChange={(e) => setNewMin(e.target.value)}
                  placeholder="opcional"
                  className={numClass}
                />
              </div>
              <Button size="sm" onClick={addZone} loading={zoneBusy === "__new"}>
                Adicionar
              </Button>
            </div>
          )}
          {zoneError && <p className="mt-2 rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{zoneError}</p>}
        </div>
      </div>
    </Card>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-inset px-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm font-medium text-ink">{label}</span>
    </label>
  );
}
