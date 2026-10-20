import type messageTypesModule from "../message-types.types.ts";
import type typesModule from "../types.types.ts";

declare namespace transcriptTypes {
  type TranscriptMessages = readonly { role: string }[];

  interface ToolStateChanges {
    toolsAdded: typesModule.Tool[];
    toolsRemoved: typesModule.ToolReference[];
  }

  interface TranscriptTools {
    requestTools: typesModule.Tool[];
    anchorsAdditions: boolean;
  }

  type TranscriptContext = messageTypesModule.TranscriptContext;
}

export type { transcriptTypes as default };
