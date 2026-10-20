import type interactiveTuiSupport from "./interactive-tui-support.ts";

declare namespace interactiveTuiSupportTypes {
  type RecordingTerminal = (typeof interactiveTuiSupport.RecordingTerminal)["prototype"];
}

export type { interactiveTuiSupportTypes as default };
