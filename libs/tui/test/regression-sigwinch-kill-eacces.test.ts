import assert from "node:assert";
import { after, describe, it } from "node:test";

import terminalProtocol from "../src/terminal-protocol.ts";

const { refreshTerminalDimensions } = terminalProtocol;

const originalKill = process.kill;

const originalPlatform = process.platform;

describe("refreshTerminalDimensions", () => {
  after(() => {
    process.kill = originalKill;
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });
  it("does not throw when kill(2) returns EACCES for self-signal", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.kill = ((): typeof process.kill => (pid, _signal) => {
      if (pid === process.pid) {
        const err = new Error("kill EACCES") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      return originalKill.call(process, pid, _signal);
    })();

    assert.doesNotThrow(() => {
      refreshTerminalDimensions();
    });
  });

  it("does not call kill on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    let killCalled = false;
    process.kill = ((): typeof process.kill => () => {
      killCalled = true;
      return true;
    })();

    refreshTerminalDimensions();

    assert.strictEqual(killCalled, false, "kill should not be called on win32");
  });
});

describe("refreshTerminalDimensions", () => {
  after(() => {
    process.kill = originalKill;
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });
  it("preserves other error codes", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.kill = ((): typeof process.kill => () => {
      const err = new Error("kill EPERM") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    })();

    assert.doesNotThrow(() => {
      refreshTerminalDimensions();
    });
  });
});
