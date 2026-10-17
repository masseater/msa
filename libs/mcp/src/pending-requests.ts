import { Deferred, Effect, type Fiber } from "effect";

import { foreign, type McpForeignError } from "./foreign.ts";
import { type JsonRpcId, McpTimeoutError } from "./protocol/jsonrpc.ts";
import type { ProgressNotification } from "./protocol/types.ts";

export interface PendingRequest {
  deferred: Deferred.Deferred<unknown, McpForeignError>;
  timeoutMs: number;
  timer: Fiber.Fiber<void> | undefined;
  signal: AbortSignal | undefined;
  onAbort: () => void;
  sendController: AbortController;
  cancellable: boolean;
  onProgress: ((progress: ProgressNotification) => void) | undefined;
  progressToken: JsonRpcId | undefined;
}

export type CancelNotifier = (id: JsonRpcId, reason: string | undefined) => void;

export class PendingRequests {
  private pending = new Map<JsonRpcId, PendingRequest>();
  private progressRequests = new Map<JsonRpcId, JsonRpcId>();
  private notifyCancel: CancelNotifier;

  constructor(notifyCancel: CancelNotifier) {
    this.notifyCancel = notifyCancel;
  }

  add(id: JsonRpcId, entry: PendingRequest): void {
    this.pending.set(id, entry);
    if (entry.progressToken !== undefined) this.progressRequests.set(entry.progressToken, id);
    entry.signal?.addEventListener("abort", entry.onAbort, { once: true });
    this.armTimeout(id, entry);
  }

  resolve(id: JsonRpcId, outcome: Effect.Effect<unknown, McpForeignError>): boolean {
    const entry = this.pending.get(id);
    if (entry === undefined) return false;
    this.remove(id, entry);
    Deferred.doneUnsafe(entry.deferred, outcome);
    return true;
  }

  progress(token: JsonRpcId): PendingRequest | undefined {
    const requestId = this.progressRequests.get(token);
    const entry = requestId === undefined ? undefined : this.pending.get(requestId);
    if (requestId === undefined || entry === undefined) return undefined;
    this.armTimeout(requestId, entry);
    return entry;
  }

  cancel(id: JsonRpcId, error: unknown, notifyServer: boolean, reason?: string): void {
    if (!this.resolve(id, Effect.fail(foreign(error)))) return;
    if (notifyServer) this.notifyCancel(id, reason);
  }

  rejectAll(error: unknown): void {
    for (const [id, entry] of this.pending) {
      this.remove(id, entry);
      Deferred.doneUnsafe(entry.deferred, Effect.fail(foreign(error)));
    }
  }

  private armTimeout(id: JsonRpcId, entry: PendingRequest): void {
    entry.timer?.interruptUnsafe();
    entry.timer = undefined;
    if (!Number.isFinite(entry.timeoutMs) || entry.timeoutMs <= 0) return;
    const timedOut = Effect.sync(() => {
      this.cancel(id, new McpTimeoutError(entry.timeoutMs), entry.cancellable, "Request timed out");
    });
    entry.timer = Effect.runFork(Effect.delay(timedOut, entry.timeoutMs));
  }

  private remove(id: JsonRpcId, entry: PendingRequest): void {
    this.pending.delete(id);
    entry.timer?.interruptUnsafe();
    if (entry.progressToken !== undefined) this.progressRequests.delete(entry.progressToken);
    entry.signal?.removeEventListener("abort", entry.onAbort);
    entry.sendController.abort();
  }
}
