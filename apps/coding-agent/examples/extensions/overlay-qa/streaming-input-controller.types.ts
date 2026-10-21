import type StreamingInputControllerClass from "./streaming-input-controller.ts";

declare namespace streamingInputControllerTypes {
  type StreamingInputController = (typeof StreamingInputControllerClass)["prototype"];
}

export type { streamingInputControllerTypes as default };
