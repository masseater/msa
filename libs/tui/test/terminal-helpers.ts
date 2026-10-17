import { setKittyProtocolActive } from "../src/keys.ts";
import { ProcessTerminal } from "../src/terminal.ts";

export type NegotiationHarness = {
  terminal: ProcessTerminal;
  writes: string[];
  send(data: string): void;
  getInput(): string | undefined;
  cleanup(): void;
};

export function setupNegotiation(): NegotiationHarness {
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
    terminal,
    writes,
    send(data: string): void {
      dataHandler?.(data);
    },
    getInput(): string | undefined {
      return input;
    },
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
  };
}

export const working = "\x1b]7501;state=working:app=msa\x1b\\";

export const clear = "\x1b]7501;state=clear\x1b\\";

export function withOverride(value: string | undefined, fn: () => void): void {
  const previous = process.env["MSA_PROGRAM_STATUS"];
  if (value === undefined) delete process.env["MSA_PROGRAM_STATUS"];
  else process.env["MSA_PROGRAM_STATUS"] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env["MSA_PROGRAM_STATUS"];
    else process.env["MSA_PROGRAM_STATUS"] = previous;
  }
}
