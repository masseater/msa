import { DurableObjectSqliteExecutor } from "./cloudflare-executor.ts";

export class DurableObjectSqliteTransaction extends DurableObjectSqliteExecutor {
  active = true;

  protected override check(): void {
    if (!this.active) throw new Error("SQLite transaction handle is no longer active");
  }
}
