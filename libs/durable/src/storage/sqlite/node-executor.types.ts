import type NodeSqliteExecutorClass from "./node-executor.ts";

declare namespace nodeExecutorTypes {
  type NodeSqliteExecutor = NodeSqliteExecutorClass;
}

export type { nodeExecutorTypes as default };
