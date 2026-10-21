import type RecordingTerminalClass from "./interactive-tui-support.ts";

declare namespace interactiveTuiSupportTypes {
  type RecordingTerminal = (typeof RecordingTerminalClass)["prototype"];
}

export type { interactiveTuiSupportTypes as default };
