import type chordTypes from "@msa/chord/index.types";
import type durableTypes from "@msa/durable/index.types";

declare namespace sessionTablesSupportTypes {
  type Checkpoint = { phase: "start" } | { phase: "next"; step: number };

  type Progress = { lines: string[] };

  type Notes = { text: string };

  type AnyTask = durableTypes.TaskRecord<
    chordTypes.JsonValue,
    chordTypes.JsonValue,
    chordTypes.JsonValue
  >;
}

export type { sessionTablesSupportTypes as default };
