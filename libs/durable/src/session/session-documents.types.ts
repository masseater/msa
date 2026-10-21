import type documentsTypes from "../documents.types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

declare namespace sessionDocumentsTypes {
  type AnyDocDefinition = documentsTypes.AnyDocDefinition;

  type LoadedDocument = transactionTypesModule.LoadedDocument;
}

export type { sessionDocumentsTypes as default };
