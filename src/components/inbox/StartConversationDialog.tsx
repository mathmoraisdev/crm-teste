"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { maskBrPhone } from "@/lib/phone";
import type { InboxNumber } from "@/server/services/inbox.service";

/**
 * "Nova conversa" no inbox (estilo WhatsApp Web): o operador cola o número que
 * recebeu, informa o nome (opcional) e escolhe o chip — o backend resolve/cria
 * o lead e o chat abre direto, sem cadastrar antes nem depender de inbound.
 *
 * O submit é delegado ao pai (`onSubmit`), que chama a rota e abre a conversa;
 * o sucesso fecha o modal (lá), e o erro é mostrado aqui sem fechar — espelho do
 * `ConfirmDialog`.
 */
export function StartConversationDialog({
  open,
  onClose,
  numbers,
  defaultNumberId,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  numbers: InboxNumber[];
  defaultNumberId: string | null;
  onSubmit: (phone: string, name: string | undefined, numberId: string | null) => Promise<void>;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  // null = "Automático" (servidor pega o chip conectado primário).
  const [numberId, setNumberId] = useState<string | null>(defaultNumberId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reseta o formulário a cada abertura e sincroniza o chip default com o filtro
  // do inbox (se o operador está num chip, pré-seleciona ele).
  useEffect(() => {
    if (!open) return;
    setPhone("");
    setName("");
    setNumberId(defaultNumberId);
    setError(null);
    setSubmitting(false);
  }, [open, defaultNumberId]);

  const numberLabel = (n: InboxNumber) => n.displayName?.trim() || n.label;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) {
      setError("Informe o número de WhatsApp.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(trimmed, name.trim() || undefined, numberId);
      // sucesso → o pai fecha o modal
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao abrir a conversa");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title="Nova conversa">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink">Número (WhatsApp)</label>
          <Input
            value={phone}
            onChange={(e) => setPhone(maskBrPhone(e.target.value))}
            inputMode="tel"
            placeholder="(41) 99999-8888"
            autoFocus
          />
          <p className="text-xs text-slate-400">
            Cole o número que te passaram. Se ainda não for contato, criamos o lead e
            abrimos o chat.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink">Nome (opcional)</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como quer chamar este lead"
          />
        </div>

        {numbers.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink">Enviar pelo chip</label>
            <Select
              value={numberId ?? ""}
              onChange={(e) => setNumberId(e.target.value || null)}
            >
              <option value="">Automático (primário conectado)</option>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {numberLabel(n)}
                </option>
              ))}
            </Select>
          </div>
        )}

        {error && (
          <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={submitting}>
            Abrir conversa
          </Button>
        </div>
      </form>
    </Modal>
  );
}
