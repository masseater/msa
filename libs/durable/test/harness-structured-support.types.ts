import type { Context } from "@msa/chord";
import type { Conversation, Harness, NextTaskState, Registry, TaskRuntime } from "@msa/durable";

declare namespace harnessStructuredSupportTypes {
  type NodeInput = { name: string };

  type NodeCheckpoint = { phase: "run" } | { phase: "resume"; round: number };

  type NodeRuntime = TaskRuntime<NodeInput, NodeCheckpoint, string, object>;

  type Next = NextTaskState<NodeCheckpoint, string>;

  type Behavior = {
    run?(runtime: NodeRuntime, ctx: Context): Promise<void>;
    resume?(runtime: NodeRuntime, ctx: Context, round: number): Promise<void>;
    abort?(runtime: NodeRuntime, ctx: Context): Promise<void>;
  };

  type Ending = "completed" | "failed" | "throw";

  type Opened = {
    harness: Harness;
    root: Conversation;
    registry: Registry;
    reports: unknown[];
  };
}

export type { harnessStructuredSupportTypes as default };
