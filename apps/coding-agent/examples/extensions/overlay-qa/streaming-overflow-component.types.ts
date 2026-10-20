import type StreamingOverflowComponentClass from "./streaming-overflow-component.ts";

declare namespace streamingOverflowComponentTypes {
  type StreamingOverflowComponent = (typeof StreamingOverflowComponentClass)["prototype"];
}

export type { streamingOverflowComponentTypes as default };
