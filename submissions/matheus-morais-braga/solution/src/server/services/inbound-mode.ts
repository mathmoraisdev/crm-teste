export interface InboundMode {
  reply: boolean;         // IA responde automaticamente
  qualify: boolean;       // roda qualificação/score
  allowSchedule: boolean; // pode propor/agendar reunião
}

/** PURA: traduz os toggles da empresa no comportamento do inbound. */
export function decideInboundMode(cfg: {
  autoReplyEnabled: boolean;
  qualifyEnabled: boolean;
  scheduleEnabled: boolean;
}): InboundMode {
  return {
    reply: cfg.autoReplyEnabled,
    qualify: cfg.qualifyEnabled,
    allowSchedule: cfg.scheduleEnabled,
  };
}
