import type { DatabaseSync, StatementSync } from "node:sqlite";

import { Effect } from "effect";

import { NodeSqliteExecutor } from "./node-executor.ts";

export type TransactionScope = { active: boolean };

export class NodeSqliteTransaction extends NodeSqliteExecutor {
  private readonly scope: TransactionScope;

  constructor(
    database: DatabaseSync,
    statements: Map<string, StatementSync>,
    scope: TransactionScope,
  ) {
    super(database, statements);
    this.scope = scope;
  }

  protected runOperation<T>(operation: () => T): Promise<T> {
    return Effect.runPromise(
      Effect.sync(() => {
        if (!this.scope.active) throw new Error("SQLite transaction handle is no longer active");
        return operation();
      }),
    );
  }
}
