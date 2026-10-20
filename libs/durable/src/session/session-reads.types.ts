import type chordTypes from "@msa/chord/index.types";

import type documentsTypes from "../documents.types.ts";
import type sessionStateTypes from "./session-state.types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

declare namespace sessionReadsTypes {
  type Resolved = {
    readonly definition: documentsTypes.AnyDocToken["definition"];
    readonly resolved: documentsTypes.ResolvedAddress;
    readonly context: chordTypes.Context;
  };

  type AnyDocToken = documentsTypes.AnyDocToken;

  type SessionState = sessionStateTypes.SessionState;

  type LoadedDocument = transactionTypesModule.LoadedDocument;
}

export type { sessionReadsTypes as default };
