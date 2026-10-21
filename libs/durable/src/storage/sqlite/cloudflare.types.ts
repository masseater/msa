import type cloudflareExecutorTypes from "./cloudflare-executor.types.ts";
import type cloudflare from "./cloudflare.ts";

declare namespace cloudflareTypes {
  type DurableObjectSqliteStorage = cloudflareExecutorTypes.DurableObjectSqliteStorage;

  type DurableObjectSqliteDatabase = (typeof cloudflare.DurableObjectSqliteDatabase)["prototype"];
}

export type { cloudflareTypes as default };
