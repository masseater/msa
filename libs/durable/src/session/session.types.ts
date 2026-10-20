import type sessionReadsTypes from "./session-reads.types.ts";
import type sessionStateTypes from "./session-state.types.ts";
import type SessionImplClass from "./session.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

declare namespace sessionTypes {
  type SessionImpl = SessionImplClass;

  type AnyDocToken = sessionReadsTypes.AnyDocToken;

  type DocumentCacheSizes = sessionStateTypes.DocumentCacheSizes;

  type SessionState = sessionStateTypes.SessionState;

  type Transaction = transactionTypesModule.Transaction;

  type TransactionHost = transactionTypesModule.TransactionHost;

  type TransactionScope = transactionTypesModule.TransactionScope;
}

export type { sessionTypes as default };
