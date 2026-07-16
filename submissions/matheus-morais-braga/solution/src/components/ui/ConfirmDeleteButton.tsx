"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * Botão de lixeira com confirmação embutida (abre um ConfirmDialog antes de apagar).
 * Drop-in para os ícones de excluir espalhados nas listas — evita exclusão acidental
 * e centraliza o tratamento de loading/erro no ConfirmDialog. Use `trigger` para um
 * gatilho customizado (recebe `open` p/ abrir o diálogo).
 */
export function ConfirmDeleteButton({
  onConfirm,
  label,
  title = "Apagar",
  message,
  confirmLabel = "Apagar",
  size = 15,
  className,
  disabled = false,
  trigger,
}: {
  onConfirm: () => void | Promise<void>;
  label: string; // aria-label do gatilho
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  size?: number;
  className?: string;
  disabled?: boolean;
  trigger?: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={label}
          disabled={disabled}
          className={cn("text-slate-400 hover:text-danger disabled:opacity-50", className)}
        >
          <Trash2 size={size} />
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        onConfirm={async () => {
          await onConfirm();
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
