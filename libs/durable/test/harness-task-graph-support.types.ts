import type { TaskId } from "@msa/durable";

declare namespace harnessTaskGraphSupportTypes {
  type ParentState = { phase: "spawn" } | { phase: "join"; child: TaskId } | { phase: "finish" };
}

export type { harnessTaskGraphSupportTypes as default };
