import type { ProcessTerminal } from "../src/terminal.ts";

declare namespace terminalHelpersTypes {
  type NegotiationHarness = {
    terminal: ProcessTerminal;
    writes: string[];
    send(data: string): void;
    getInput(): string | undefined;
    cleanup(): void;
  };
}

export type { terminalHelpersTypes as default };
