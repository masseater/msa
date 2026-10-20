import type { DatabaseSync, StatementSync } from "node:sqlite";

import type databaseTypes from "./database.ts";

export default abstract class NodeSqliteExecutor implements databaseTypes.SqliteExecutor {
  protected readonly database: DatabaseSync;
  protected readonly statements: Map<string, StatementSync>;

  constructor(database: DatabaseSync, statements: Map<string, StatementSync>) {
    this.database = database;
    this.statements = statements;
  }

  exec(sql: string): Promise<void> {
    return this.runOperation(() => {
      this.database.exec(sql);
    });
  }

  run(sql: string, ...params: databaseTypes.SqliteValue[]): Promise<void> {
    return this.runOperation(() => {
      this.statement(sql).run(...params);
    });
  }

  get<T extends object>(
    sql: string,
    ...params: databaseTypes.SqliteValue[]
  ): Promise<T | undefined> {
    return this.runOperation(() => this.statement(sql).get(...params) as T | undefined);
  }

  all<T extends object>(sql: string, ...params: databaseTypes.SqliteValue[]): Promise<T[]> {
    return this.runOperation(() => this.statement(sql).all(...params) as T[]);
  }

  protected abstract runOperation<T>(operation: () => T): Promise<T>;

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = this.database.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
}
