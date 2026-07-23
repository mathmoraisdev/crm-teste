import { describe, it, expect } from "vitest";
import { classifyDisconnect } from "./bansignals";

describe("classifyDisconnect", () => {
  it("401 (loggedOut) → LOGGED_OUT (deslogado, reconectável por QR)", () => {
    expect(classifyDisconnect(401)).toBe("LOGGED_OUT");
  });
  it("403 (forbidden) → BANNED (ban efetivo)", () => {
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
