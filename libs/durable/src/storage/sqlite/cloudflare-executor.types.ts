import type DurableObjectSqliteExecutorClass from "./cloudflare-executor.ts";

declare namespace cloudflareExecutorTypes {
  type DurableObjectSqlValue = ArrayBuffer | string | number | null;

  type DurableObjectSqliteStorage = {
    readonly sql: {
      exec(
        query: string,
        ...bindings: DurableObjectSqlValue[]
      ): { toArray(): Record<string, DurableObjectSqlValue>[] };
    };
    transaction<T>(closure: () => Promise<T>): Promise<T>;
  };

  type DurableObjectSqliteExecutor = DurableObjectSqliteExecutorClass;
}

export type { cloudflareExecutorTypes as default };
