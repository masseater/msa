import type harnessTypes from "../src/harness/index.types.ts";
import type durableTypes from "../src/index.types.ts";
import type sessionTypes from "../src/session/session.types.ts";

declare namespace sessionDocumentCacheBenchTypes {
  type ConversationId = durableTypes.ConversationId;

  type Harness = harnessTypes.Harness;

  type SessionImpl = sessionTypes.SessionImpl;
}

export type { sessionDocumentCacheBenchTypes as default };
