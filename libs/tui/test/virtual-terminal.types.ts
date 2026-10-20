import type VirtualTerminalClass from "./virtual-terminal.ts";

declare namespace virtualTerminalTypes {
  type VirtualTerminal = (typeof VirtualTerminalClass)["prototype"];
}

export type { virtualTerminalTypes as default };
