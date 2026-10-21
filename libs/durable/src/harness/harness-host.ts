import type chordTypes from "@msa/chord/index.types";

import type sessionTypes from "../session/session.types.ts";
import type schedulerTypes from "./scheduler.types.ts";
import type submissionsTypes from "./submissions.types.ts";
import type typesModule from "./types.types.ts";
import type viewTypes from "./view.types.ts";

declare namespace harnessHostTypes {
  type CreateTarget =
    | { readonly kind: "root" }
    | { readonly kind: "independent"; readonly ownership: typesModule.ConversationOwnership }
    | {
        readonly kind: "fork";
        readonly parentId: typesModule.ConversationId;
        readonly at: typesModule.EntryId;
        readonly ownership: typesModule.ConversationOwnership;
      };

  type CreateOptions = {
    readonly agent?: typesModule.AgentChange;
    readonly init?: typesModule.ConversationInit;
  };

  type HostHarness<Tool extends typesModule.ToolRegistration> = sessionTypes.SessionImpl & {
    resolveAgent(
      id: typesModule.ConversationId,
      snapshot: typesModule.RegistrySnapshot<Tool> | undefined,
      context: chordTypes.Context,
    ): Promise<typesModule.Agent<Tool>>;
  };

  type ConversationHost<Tool extends typesModule.ToolRegistration> = {
    readonly harness: HostHarness<Tool>;
    readonly storage: typesModule.Storage;
    readonly tasks: schedulerTypes.TaskScheduler;
    readonly submissions: submissionsTypes.Submissions;
    readonly views: viewTypes.ConversationViews;
    readonly now: () => number;
    create(
      target: CreateTarget,
      options: CreateOptions,
      context: chordTypes.Context,
    ): Promise<typesModule.Conversation>;
  };
}

export type { harnessHostTypes as default };
