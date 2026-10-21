import type terminalTypes from "../src/terminal.types.ts";

declare namespace terminalHelpersTypes {
  type NegotiationHarness = {
    terminal: terminalTypes.ProcessTerminal;
    writes: string[];
    send(data: string): void;
    getInput(): string | undefined;
    cleanup(): void;
  };
}

export type { terminalHelpersTypes as default };
