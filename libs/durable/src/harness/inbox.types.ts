import type chordTypes from "@msa/chord/index.types";

import type typesModule from "./types.types.ts";

declare namespace inboxTypes {
  type InboxItem =
    | {
        id: typesModule.SubmissionId;
        mode: "steer" | "followUp";
        content: chordTypes.JsonRepresentation<typesModule.UserInput>;
        entry?: chordTypes.JsonRepresentation<typesModule.InputEntry>;
      }
    | { id: typesModule.SubmissionId; mode: "write"; entry: typesModule.JsonObject };

  type InboxState = { items: InboxItem[] };

  type QueueModes = Pick<typesModule.Settings, "steeringMode" | "followUpMode">;

  type Boundary = {
    readonly conversationId: typesModule.ConversationId;
    readonly inbox: chordTypes.Draft<InboxState>;
    readonly steeringMode: typesModule.QueueMode;
    readonly followUpMode: typesModule.QueueMode;
    head: typesModule.EntryId | undefined;
  };

  type BoundaryResult = { readonly users: typesModule.SubmissionId[]; readonly reset: boolean };
}

export type { inboxTypes as default };
