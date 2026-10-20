import type toolOutputStorageTypes from "./tool-output-storage.types.ts";

declare namespace toolOutputScenarioTypes {
  type Rate = "low" | "normal" | "high";

  type Scenario =
    | {
        kind: "rate";
        backend: toolOutputStorageTypes.Backend;
        rate: Rate;
        retain: "head" | "tail";
        tools: number;
        seconds?: number;
      }
    | {
        kind: "firehose";
        backend: toolOutputStorageTypes.Backend;
        retain: "head" | "tail";
        repetitive?: boolean;
      }
    | { kind: "cat"; backend: toolOutputStorageTypes.Backend };
}

export type { toolOutputScenarioTypes as default };
