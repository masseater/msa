import type RecordingTerminalClass from "./recording-terminal.ts";

declare namespace recordingTerminalTypes {
  type RecordingTerminal = (typeof RecordingTerminalClass)["prototype"];
}

export type { recordingTerminalTypes as default };
