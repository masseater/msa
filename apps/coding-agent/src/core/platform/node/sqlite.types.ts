import type { StatementSync } from "node:sqlite";

declare namespace nodeSqliteTypes {
  type Statement = StatementSync;
}

export type { nodeSqliteTypes as default };
