import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "crypto";

/**
 * Cifra simétrica para credenciais de IA dos usuários (BYOK).
 * AES-256-GCM. Formato persistido: "<iv-hex>:<authTag-hex>:<ciphertext-hex>".
 * A chave mestra (32 bytes) vem de ENCRYPTION_KEY (64 chars hex).
 */
const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ENCRYPTION_KEY ausente ou inválida (esperado 64 chars hex = 32 bytes).",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96 bits, recomendado p/ GCM
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Payload cifrado malformado.");
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
