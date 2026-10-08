"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook de gravação de áudio no navegador, com APIs nativas (sem libs).
 *
 * Fluxo: idle → (start) → recording → (stop) → preview (com Blob + URL p/ ouvir)
 * → (cancel/reset) → idle. O Blob gravado é enviado ao backend (que converte p/
 * ogg/opus e envia como nota de voz redonda pelo Baileys).
 *
 * Compatibilidade: Chrome grava `audio/webm;codecs=opus`, Firefox
 * `audio/ogg;codecs=opus`, Safari `audio/mp4`. O mime é detectado por
 * `MediaRecorder.isTypeSupported()`; o backend normaliza qualquer um p/ ogg/opus
 * antes do envio ao WhatsApp (idempotente p/ ogg). Logo este hook só grava — a
 * conversão de formato fica no worker (onde o ffmpeg vive).
 *
 * `supported=false` em SSR/navegadores sem MediaRecorder (o composer oculta o botão).
 */

export type RecorderPhase = "idle" | "recording" | "preview";

/** Mimes tentados em ordem de preferência (opus primeiro, qualidade de fala). */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

function pickSupportedMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // isTypeSupported pode lançar em alguns browsers; tenta o próximo.
    }
  }
  return ""; // fallback: deixa o MediaRecorder escolher o default
}

export interface VoiceRecorder {
  phase: RecorderPhase;
  seconds: number;
  error: string | null;
  blob: Blob | null;
  url: string | null;
  /** MediaRecorder/getUserMedia disponíveis no navegador atual. */
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  /** Limpa o preview após enviar (volta a idle sem cancelar uma gravação ativa). */
  reset: () => void;
}

export function useVoiceRecorder(): VoiceRecorder {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const mimeRef = useRef("");

  const supported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /** Cancela gravação/preview e volta ao idle, descartando o áudio. */
  const cancel = useCallback(() => {
    // Se estiver gravando, interrompe o recorder sem montar o blob (descarta).
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      try {
        recorderRef.current.stop();
      } catch {
        /* já parado */
      }
    }
    clearTimer();
    stopTracks();
    if (url) URL.revokeObjectURL(url);
    chunksRef.current = [];
    recorderRef.current = null;
    setError(null);
    setBlob(null);
    setUrl(null);
    setSeconds(0);
    setPhase("idle");
  }, [clearTimer, stopTracks, url]);

  /** Limpa só o preview (após enviar), sem descartar uma gravação em andamento. */
  const reset = useCallback(() => {
    if (url) URL.revokeObjectURL(url);
    setBlob(null);
    setUrl(null);
    setSeconds(0);
    setError(null);
    setPhase("idle");
  }, [url]);

  const start = useCallback(async () => {
    if (!supported) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mime = pickSupportedMime();
      mimeRef.current = mime;
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = mimeRef.current || chunksRef.current[0]?.type || "audio/webm";
        const recorded = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        const objUrl = URL.createObjectURL(recorded);
        setBlob(recorded);
        setUrl(objUrl);
        setPhase("preview");
      };

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setSeconds(0);
      setPhase("recording");
      recorder.start();
      clearTimer();
      timerRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
    } catch (e) {
      stopTracks();
      clearTimer();
      setPhase("idle");
      const name = e instanceof DOMException ? e.name : String(e);
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Permita o acesso ao microfone nas configurações do navegador.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError("Nenhum microfone encontrado neste dispositivo.");
      } else {
        setError("Não foi possível iniciar a gravação.");
      }
    }
  }, [supported, clearTimer, stopTracks]);

  const stop = useCallback(() => {
    clearTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* já parado — onstop não dispara, volta a idle manualmente */
        cancel();
      }
    } else {
      cancel();
    }
    // As tracks do microfone podem parar aqui (libera o indicador do mic).
    stopTracks();
  }, [cancel, clearTimer, stopTracks]);

  // Cleanup no desmontar: para tudo, revoga URL, libera o microfone.
  useEffect(() => {
    return () => {
      clearTimer();
      stopTracks();
      if (url) URL.revokeObjectURL(url);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        try {
          recorderRef.current.stop();
        } catch {
          /* noop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { phase, seconds, error, blob, url, supported, start, stop, cancel, reset };
}
