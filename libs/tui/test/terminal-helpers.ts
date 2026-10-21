import { dual } from "effect/Function";

import env from "../src/env.ts";
import keys from "../src/keys.ts";
import ProcessTerminal from "../src/terminal.ts";
import type terminalHelpersTypes from "./terminal-helpers.types.ts";

const { setKittyProtocolActive } = keys;
const { overrideEnv } = env;

function setupNegotiation(): terminalHelpersTypes.NegotiationHarness {
  const terminal = new ProcessTerminal();
  const writes: string[] = [];
  let input: string | undefined;
  let dataHandler: ((data: string) => void) | undefined;
  let cleaned = false;
  const previousWrite = process.stdout.write;
  const previousOn = process.stdin.on;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stdin.on = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === "data") dataHandler = listener as (data: string) => void;
    return process.stdin;
  }) as typeof process.stdin.on;

  (
    terminal as unknown as {
      inputHandler?: (data: string) => void;
      queryAndEnableKittyProtocol(): void;
    }
  ).inputHandler = (data) => {
    input = data;
  };
  (terminal as unknown as { queryAndEnableKittyProtocol(): void }).queryAndEnableKittyProtocol();

  return {
    cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      try {
        terminal.stop();
      } finally {
        process.stdout.write = previousWrite;
        process.stdin.on = previousOn;
        setKittyProtocolActive(false);
      }
    },
    getInput(): string | undefined {
      return input;
    },
    send(data: string): void {
      dataHandler?.(data);
    },
    terminal,
    writes,
  };
}

const working = "\x1b]7501;state=working:app=msa\x1b\\";

const clear = "\x1b]7501;state=clear\x1b\\";

const withOverride: {
  (value: string | undefined, fn: () => void): void;
  (fn: () => void): (value: string | undefined) => void;
} = dual(2, (value: string | undefined, fn: () => void): void => {
  const restore = overrideEnv({ MSA_PROGRAM_STATUS: value });
  try {
    fn();
  } finally {
    restore();
  }
});

const terminalHelpers = {
  clear,
  setupNegotiation,
  withOverride,
  working,
};

export default terminalHelpers;
