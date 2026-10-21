import type DurableObjectSqliteTransactionClass from "./cloudflare-transaction.ts";

declare namespace cloudflareTransactionTypes {
  type DurableObjectSqliteTransaction = DurableObjectSqliteTransactionClass;
}

export type { cloudflareTransactionTypes as default };
