import { describe, it, expect } from "vitest";
import { classifyDisconnect } from "./bansignals";

describe("classifyDisconnect", () => {
  it("401 (loggedOut) e 403 (forbidden) → BANNED", () => {
    expect(classifyDisconnect(401)).toBe("BANNED");
    expect(classifyDisconnect(403)).toBe("BANNED");
  });
  it("440 (connectionReplaced) → FATAL (outra sessão assumiu)", () => {
    expect(classifyDisconnect(440)).toBe("FATAL");
  });
  it("515 (restartRequired) e quedas transitórias → RECONNECT", () => {
    expect(classifyDisconnect(515)).toBe("RECONNECT");
    expect(classifyDisconnect(428)).toBe("RECONNECT"); // connectionClosed
    expect(classifyDisconnect(undefined)).toBe("RECONNECT");
  });
});
