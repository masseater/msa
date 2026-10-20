import type harnessTypes from "@msa/durable/harness.types";
import type durableTypes from "@msa/durable/index.types";

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

  type Conversation = durableTypes.Conversation;

  type Harness = harnessTypes.Harness;
}

export type { toolOutputScenarioTypes as default };
