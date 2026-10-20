import type renderChurnNullTerminal from "./render-churn-null-terminal.ts";

declare namespace renderChurnNullTerminalTypes {
  type NullTerminal = (typeof renderChurnNullTerminal.NullTerminal)["prototype"];
}

export type { renderChurnNullTerminalTypes as default };
