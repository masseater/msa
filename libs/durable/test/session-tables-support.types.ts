import type { JsonValue } from "@msa/chord";
import type durableTypes from "@msa/durable/index.types";

declare namespace sessionTablesSupportTypes {
  type Checkpoint = { phase: "start" } | { phase: "next"; step: number };

  type Progress = { lines: string[] };

  type Notes = { text: string };

  type AnyTask = durableTypes.TaskRecord<JsonValue, JsonValue, JsonValue>;
}

export type { sessionTablesSupportTypes as default };
