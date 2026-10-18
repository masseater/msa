// oxlint-disable-next-line effecttsgo/node-builtin-import -- ids are generated inside synchronous SQLite transactions
import { randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
