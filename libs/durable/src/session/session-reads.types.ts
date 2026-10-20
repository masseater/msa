import type { Context } from "@msa/chord";

import type documentsTypes from "../documents.types.ts";
import type sessionStateTypes from "./session-state.types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

declare namespace sessionReadsTypes {
  type Resolved = {
    readonly definition: documentsTypes.AnyDocToken["definition"];
    readonly resolved: documentsTypes.ResolvedAddress;
    readonly context: Context;
  };

  type AnyDocToken = documentsTypes.AnyDocToken;

  type SessionState = sessionStateTypes.SessionState;

  type LoadedDocument = transactionTypesModule.LoadedDocument;
}

export type { sessionReadsTypes as default };
