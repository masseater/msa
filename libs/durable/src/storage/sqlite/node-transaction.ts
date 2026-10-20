import type { DatabaseSync, StatementSync } from "node:sqlite";

import promiseTryModule from "../../promise-try.ts";
import NodeSqliteExecutor from "./node-executor.ts";
import type nodeTransactionTypes from "./node-transaction.types.ts";

const { promiseTry } = promiseTryModule;

export default class NodeSqliteTransaction extends NodeSqliteExecutor {
  private readonly scope: nodeTransactionTypes.TransactionScope;

  constructor(
    database: DatabaseSync,
    statements: Map<string, StatementSync>,
    scope: nodeTransactionTypes.TransactionScope,
  ) {
    super(database, statements);
    this.scope = scope;
  }

  protected runOperation<T>(operation: () => T): Promise<T> {
    return promiseTry(() => {
      if (!this.scope.active) throw new Error("SQLite transaction handle is no longer active");
      return operation();
    });
  }
}
