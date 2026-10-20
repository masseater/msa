import type sessionStateTypes from "./session-state.types.ts";
import type transactionTypes from "./transaction.types.ts";

declare namespace sessionCommitTypes {
  type SessionState = sessionStateTypes.SessionState;

  type Transaction = transactionTypes.Transaction;
}

export type { sessionCommitTypes as default };
