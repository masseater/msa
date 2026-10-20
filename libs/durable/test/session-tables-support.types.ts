import type { JsonValue } from "@msa/chord";
import type { TaskRecord } from "@msa/durable";

declare namespace sessionTablesSupportTypes {
  type Checkpoint = { phase: "start" } | { phase: "next"; step: number };

  type Progress = { lines: string[] };

  type Notes = { text: string };

  type AnyTask = TaskRecord<JsonValue, JsonValue, JsonValue>;
}

export type { sessionTablesSupportTypes as default };
