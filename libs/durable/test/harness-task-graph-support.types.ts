import type durableTypes from "@msa/durable/index.types";

declare namespace harnessTaskGraphSupportTypes {
  type ParentState =
    | { phase: "spawn" }
    | { phase: "join"; child: durableTypes.TaskId }
    | { phase: "finish" };
}

export type { harnessTaskGraphSupportTypes as default };
