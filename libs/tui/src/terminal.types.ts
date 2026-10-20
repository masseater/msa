import type ProcessTerminalClass from "./terminal.ts";

declare namespace terminalTypes {
  type ProcessTerminal = ProcessTerminalClass;
}

export type { terminalTypes as default };
