import type virtualTerminal from "./virtual-terminal.ts";

declare namespace virtualTerminalTypes {
  type VirtualTerminal = (typeof virtualTerminal.VirtualTerminal)["prototype"];
}

export type { virtualTerminalTypes as default };
