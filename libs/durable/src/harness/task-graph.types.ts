import type chordTypes from "@msa/chord/index.types";

import type sessionTypes from "../session/session.types.ts";
import type TaskGraphViewClass from "./task-graph.ts";
import type typesModule from "./types.types.ts";

declare namespace taskGraphTypes {
  type TaskGraphState =
    | { readonly status: "pending" | "running"; readonly phase: string }
    | {
        readonly status: "waiting";
        readonly phase: string;
        readonly on: readonly typesModule.TaskId[];
        readonly policy: typesModule.JoinPolicy;
      }
    | {
        readonly status: "completing";
        readonly outcome: typesModule.TaskOutcome<chordTypes.JsonValue>["status"];
      };

  type TaskGraphNode = {
    readonly id: typesModule.TaskId;
    readonly kind: string;
    readonly conversationId: typesModule.ConversationId;
    readonly owner?: typesModule.TaskId;
    readonly background: boolean;
    readonly abortRequested: boolean;
    readonly state: TaskGraphState;
    readonly conversations: readonly typesModule.ConversationId[];
  };

  type TaskGraph = {
    readonly tasks: Readonly<Record<string, TaskGraphNode>>;
  };

  type TaskGraphWatch = typesModule.WatchHandle<TaskGraph>;

  type TaskGraphView = TaskGraphViewClass;

  type SessionImpl = sessionTypes.SessionImpl;

  type CommitPublication = typesModule.CommitPublication;

  type ConversationId = typesModule.ConversationId;

  type Storage = typesModule.Storage;

  type TaskRecord<I, S, R> = typesModule.TaskRecord<I, S, R>;
}

export type { taskGraphTypes as default };
