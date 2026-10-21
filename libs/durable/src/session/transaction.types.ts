import type documentsTypes from "../documents.types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";
import type TransactionClass from "./transaction.ts";

declare namespace transactionTypes {
  type Transaction = TransactionClass;

  type AnyDocToken = documentsTypes.AnyDocToken;

  type AnyTaskRecord = transactionTypesModule.AnyTaskRecord;

  type TransactionHost = transactionTypesModule.TransactionHost;

  type TransactionScope = transactionTypesModule.TransactionScope;

  type TxState = transactionTypesModule.TxState;
}

export type { transactionTypes as default };
