import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { prisma } from "@/server/db/client";

/**
 * Auth-state do Baileys persistido no Postgres (tabela WhatsAppAuthState),
 * replicando o contrato de `useMultiFileAuthState`. Em vez de 1 arquivo por
 * chave dentro de uma pasta, cada "arquivo" vira 1 linha (numberId, key) com o
 * conteúdo serializado em JSON no campo `value`. Assim as sessões sobrevivem a
 * redeploys do Railway (o disco é efêmero) sem re-parear todos os chips.
 *
 * Serialização: usamos o BufferJSON do próprio Baileys (replacer/reviver) —
 * o mesmo que o useMultiFileAuthState usa — para preservar Buffers/Uint8Array
 * dentro de creds e keys ao passar por JSON.
 *
 * Mapeamento de chaves (espelha o nome de arquivo do useMultiFileAuthState,
 * sem a extensão .json):
 *   - "creds"
 *   - "${type}-${id}"  (ex.: "pre-key-5", "session-...", "app-state-sync-key-...")
 * O id pode conter "/" e ":" (vem de JIDs); sanitizamos igual ao Baileys faz
 * com o nome de arquivo, pra não depender de caracteres especiais na chave.
 */

// Mesma sanitização do useMultiFileAuthState (fixFileName): "/" → "__", ":" → "-".
const fixKey = (key: string) => key?.replace(/\//g, "__")?.replace(/:/g, "-");

export async function useDbAuthState(numberId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // Grava (upsert) um valor já serializável em JSON sob (numberId, key).
  const writeData = async (data: unknown, key: string): Promise<void> => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    const k = fixKey(key);
    await prisma.whatsAppAuthState.upsert({
      where: { numberId_key: { numberId, key: k } },
      create: { numberId, key: k, value },
      update: { value },
    });
  };

  // Lê e desserializa (BufferJSON.reviver restaura os Buffers). null se não há.
  const readData = async (key: string): Promise<unknown> => {
    const row = await prisma.whatsAppAuthState.findUnique({
      where: { numberId_key: { numberId, key: fixKey(key) } },
    });
    if (!row) return null;
    try {
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const removeData = async (key: string): Promise<void> => {
    await prisma.whatsAppAuthState
      .delete({ where: { numberId_key: { numberId, key: fixKey(key) } } })
      .catch(() => {}); // idempotente: ausente já é o estado desejado
  };

  const creds: AuthenticationCreds =
    ((await readData("creds")) as AuthenticationCreds | null) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              // mesmo tratamento especial do useMultiFileAuthState
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as Record<string, unknown>,
                );
              }
              data[id] = value as SignalDataTypeMap[typeof type];
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            const cat = data[category as keyof typeof data];
            for (const id in cat) {
              const value = cat[id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(value, key) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, "creds"),
  };
}
