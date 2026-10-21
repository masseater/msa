import type FakeTerminalClass from "./fake-terminal.ts";

declare namespace editToolNoFullRedrawSupportTypes {
  type FakeTerminal = (typeof FakeTerminalClass)["prototype"];
}

export type { editToolNoFullRedrawSupportTypes as default };
