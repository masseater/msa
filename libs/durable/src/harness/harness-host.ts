import type { Context } from "@msa/chord";

import type { SessionImpl } from "../session/session.ts";
import type { TaskScheduler } from "./scheduler.ts";
import type { Submissions } from "./submissions.ts";
import type {
  Agent,
  AgentChange,
  Conversation,
  ConversationId,
  ConversationInit,
  ConversationOwnership,
  EntryId,
  RegistrySnapshot,
  Storage,
  ToolRegistration,
} from "./types.ts";
import type { ConversationViews } from "./view.ts";

export type CreateTarget =
  | { readonly kind: "root" }
  | { readonly kind: "independent"; readonly ownership: ConversationOwnership }
  | {
      readonly kind: "fork";
      readonly parentId: ConversationId;
      readonly at: EntryId;
      readonly ownership: ConversationOwnership;
    };

export type CreateOptions = { readonly agent?: AgentChange; readonly init?: ConversationInit };

export type HostHarness<Tool extends ToolRegistration> = SessionImpl & {
  resolveAgent(
    id: ConversationId,
    snapshot: RegistrySnapshot<Tool> | undefined,
    context: Context,
  ): Promise<Agent<Tool>>;
};

export type ConversationHost<Tool extends ToolRegistration> = {
  readonly harness: HostHarness<Tool>;
  readonly storage: Storage;
  readonly tasks: TaskScheduler;
  readonly submissions: Submissions;
  readonly views: ConversationViews;
  readonly now: () => number;
  create(target: CreateTarget, options: CreateOptions, context: Context): Promise<Conversation>;
};
