import assert from "node:assert";
import { describe, it, mock } from "node:test";

import { overrideEnv } from "../src/env.ts";
import { ProcessTerminal } from "../src/terminal.ts";
import { clear, setupNegotiation, withOverride, working } from "./terminal-helpers.ts";

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
  describe("program status (OSC 7501)", () => {
    it("does not let a DA reply from before a restart end the new query", () => {
      withOverride(undefined, () => {
        const harness = setupNegotiation();
        try {
          harness.terminal.setProgramStatus({ state: "working", app: "msa" });
          harness.terminal.stop();
          (
            harness.terminal as unknown as { queryAndEnableKittyProtocol(): void }
          ).queryAndEnableKittyProtocol();

          harness.send("\x1b[?62;4;52c");
          harness.send("\x1b]7501;?\x1b\\");
          harness.send("\x1b[?62;4;52c");
          assert.equal(harness.writes.at(-1), working);
          assert.equal(harness.getInput(), undefined);
        } finally {
          harness.cleanup();
        }
      });
    });
  });
});

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
  describe("program status (OSC 7501)", () => {
    it("clears the status on stop and reports it again after restart", () => {
      withOverride(undefined, () => {
        const harness = setupNegotiation();
        try {
          harness.terminal.setProgramStatus({ state: "working", app: "msa" });
          harness.send("\x1b]7501;?\x1b\\");
          harness.terminal.stop();
          assert.ok(harness.writes.includes(clear));

          const writesBeforeRestart = harness.writes.length;
          harness.terminal.setProgramStatus({ state: "working", app: "msa" });
          assert.equal(harness.writes.length, writesBeforeRestart);

          (
            harness.terminal as unknown as { queryAndEnableKittyProtocol(): void }
          ).queryAndEnableKittyProtocol();
          harness.send("\x1b]7501;?\x1b\\");
          assert.equal(harness.writes.at(-1), working);
        } finally {
          harness.cleanup();
        }
      });
    });
  });
});

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
  it("replays buffered CSI-prefix input when it is not a Kitty response", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[");
      mock.timers.tick(50);

      assert.equal(harness.getInput(), undefined);

      mock.timers.tick(150);

      assert.equal(harness.getInput(), "\x1b[");
    } finally {
      harness.cleanup();
      mock.timers.reset();
    }
  });
});

describe("ProcessTerminal progress", () => {
  it("writes a valid OSC 9;4 clear sequence", () => {
    const terminal = new ProcessTerminal();
    const writes: string[] = [];
    const previousWrite = process.stdout.write;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      terminal.setProgress(false);
      assert.deepEqual(writes, ["\x1b]9;4;0\x07"]);
    } finally {
      process.stdout.write = previousWrite;
    }
  });
});

describe("ProcessTerminal dimensions", () => {
  it("falls back to COLUMNS and LINES before default dimensions", () => {
    const previousColumnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    const previousRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    const restoreEnv = overrideEnv({ COLUMNS: "123", LINES: "45" });

    try {
      Object.defineProperty(process.stdout, "columns", { value: undefined, configurable: true });
      Object.defineProperty(process.stdout, "rows", { value: undefined, configurable: true });

      const terminal = new ProcessTerminal();

      assert.equal(terminal.columns, 123);
      assert.equal(terminal.rows, 45);
    } finally {
      if (previousColumnsDescriptor === undefined) {
        Reflect.deleteProperty(process.stdout, "columns");
      } else {
        Object.defineProperty(process.stdout, "columns", previousColumnsDescriptor);
      }
      if (previousRowsDescriptor === undefined) {
        Reflect.deleteProperty(process.stdout, "rows");
      } else {
        Object.defineProperty(process.stdout, "rows", previousRowsDescriptor);
      }
      restoreEnv();
    }
  });
});
