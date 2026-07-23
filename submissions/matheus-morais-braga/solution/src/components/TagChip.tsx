"use client";

import { X } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";

const TONES: Tone[] = ["slate", "blue", "amber", "green", "red", "violet", "emerald"];

function toTone(color: string): Tone {
  return (TONES as string[]).includes(color) ? (color as Tone) : "slate";
}

/** Etiqueta colorida de um lead. `onRemove` mostra o "x" para desatribuir. */
export function TagChip({
  name,
  color,
  onRemove,
}: {
  name: string;
  color: string;
  onRemove?: () => void;
}) {
  return (
    <Badge tone={toTone(color)}>
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-0.5 ml-0.5 rounded-full hover:opacity-70"
          aria-label={`Remover tag ${name}`}
        >
          <X size={11} />
        </button>
      )}
    </Badge>
  );
}
