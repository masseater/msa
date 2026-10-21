import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Deferred, Effect, Exit } from "effect";

export default class ToolResults {
  private readonly waiting = new Map<string, Deferred.Deferred<CallToolResult>>();
  private readonly ready = new Map<string, CallToolResult>();

  take(id: string): Promise<CallToolResult> {
    const result = this.ready.get(id);
    if (result !== undefined) {
      this.ready.delete(id);
      return Promise.resolve(result);
    }
    const waiter = Deferred.makeUnsafe<CallToolResult>();
    this.waiting.set(id, waiter);
    return Effect.runPromise(Deferred.await(waiter));
  }

  give(id: string, result: CallToolResult): void {
    const waiter = this.waiting.get(id);
    if (waiter === undefined) {
      this.ready.set(id, result);
      return;
    }
    this.waiting.delete(id);
    Deferred.doneUnsafe(waiter, Exit.succeed(result));
  }

  closeAll(result: CallToolResult): void {
    for (const waiter of this.waiting.values()) Deferred.doneUnsafe(waiter, Exit.succeed(result));
    this.waiting.clear();
  }
}
