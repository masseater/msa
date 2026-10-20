import type StreamingInputPanelClass from "./streaming-input-panel.ts";

declare namespace streamingInputPanelTypes {
  type StreamingInputPanel = (typeof StreamingInputPanelClass)["prototype"];
}

export type { streamingInputPanelTypes as default };
