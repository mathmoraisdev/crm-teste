import { env } from "@/lib/env";
import type { WhatsAppService } from "./types";
import { createMockWhatsApp } from "./mock";
import { createCloudWhatsApp } from "./cloud-api";
import { createBaileysWhatsApp } from "./baileys/service";

/**
 * Factory + singleton da camada WhatsApp. Resolve a implementação por
 * WHATSAPP_MODE. O resto do código importa só `getWhatsApp()`.
 */
let instance: WhatsAppService | null = null;

export function getWhatsApp(): WhatsAppService {
  if (instance) return instance;
  instance =
    env.WHATSAPP_MODE === "cloud-api"
      ? createCloudWhatsApp()
      : env.WHATSAPP_MODE === "baileys"
        ? createBaileysWhatsApp()
        : createMockWhatsApp();
  return instance;
}

export type { WhatsAppService, WhatsAppSendResult } from "./types";
