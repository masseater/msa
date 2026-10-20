import type dualTypes from "../dual.ts";
import type sessionReadsTypes from "./session-reads.types.ts";
import type sessionStateTypes from "./session-state.types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

declare namespace sessionObserveTypes {
  type Dual3<A, B, C, R> = dualTypes.Dual3<A, B, C, R>;

  type SessionState = sessionStateTypes.SessionState;

  type LoadedDocument = transactionTypesModule.LoadedDocument;

  type AnyDocToken = sessionReadsTypes.AnyDocToken;

  type Resolved = sessionReadsTypes.Resolved;
}

export type { sessionObserveTypes as default };
