import type { Context } from "@msa/chord";
import type durableTypes from "@msa/durable/index.types";

declare namespace harnessStructuredSupportTypes {
  type NodeInput = { name: string };

  type NodeCheckpoint = { phase: "run" } | { phase: "resume"; round: number };

  type NodeRuntime = durableTypes.TaskRuntime<NodeInput, NodeCheckpoint, string, object>;

  type Next = durableTypes.NextTaskState<NodeCheckpoint, string>;

  type Behavior = {
    run?(runtime: NodeRuntime, ctx: Context): Promise<void>;
    resume?(runtime: NodeRuntime, ctx: Context, round: number): Promise<void>;
    abort?(runtime: NodeRuntime, ctx: Context): Promise<void>;
  };

  type Ending = "completed" | "failed" | "throw";

  type Opened = {
    harness: durableTypes.Harness;
    root: durableTypes.Conversation;
    registry: durableTypes.Registry;
    reports: unknown[];
  };
}

export type { harnessStructuredSupportTypes as default };
