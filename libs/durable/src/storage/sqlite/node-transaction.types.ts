import type NodeSqliteTransactionClass from "./node-transaction.ts";

declare namespace nodeTransactionTypes {
  type TransactionScope = { active: boolean };

  type NodeSqliteTransaction = NodeSqliteTransactionClass;
}

export type { nodeTransactionTypes as default };
