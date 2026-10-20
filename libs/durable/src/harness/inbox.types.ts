import type { Draft, JsonRepresentation } from "@msa/chord";

import type typesModule from "./types.types.ts";

declare namespace inboxTypes {
  type InboxItem =
    | {
        id: typesModule.SubmissionId;
        mode: "steer" | "followUp";
        content: JsonRepresentation<typesModule.UserInput>;
        entry?: JsonRepresentation<typesModule.InputEntry>;
      }
    | { id: typesModule.SubmissionId; mode: "write"; entry: typesModule.JsonObject };

  type InboxState = { items: InboxItem[] };

  type QueueModes = Pick<typesModule.Settings, "steeringMode" | "followUpMode">;

  type Boundary = {
    readonly conversationId: typesModule.ConversationId;
    readonly inbox: Draft<InboxState>;
    readonly steeringMode: typesModule.QueueMode;
    readonly followUpMode: typesModule.QueueMode;
    head: typesModule.EntryId | undefined;
  };

  type BoundaryResult = { readonly users: typesModule.SubmissionId[]; readonly reset: boolean };
}

export type { inboxTypes as default };
