import { Deferred, Effect } from "effect";

import foreignModule from "./foreign.ts";
import type foreignTypes from "./foreign.types.ts";
import type pendingRequestsTypes from "./pending-requests.types.ts";
import jsonrpcModule from "./protocol/jsonrpc.ts";
import type jsonrpcTypes from "./protocol/jsonrpc.types.ts";

const { foreign } = foreignModule;
const { McpTimeoutError } = jsonrpcModule;

export default class PendingRequests {
  private pending = new Map<jsonrpcTypes.JsonRpcId, pendingRequestsTypes.PendingRequest>();
  private progressRequests = new Map<jsonrpcTypes.JsonRpcId, jsonrpcTypes.JsonRpcId>();
  private notifyCancel: pendingRequestsTypes.CancelNotifier;

  constructor(notifyCancel: pendingRequestsTypes.CancelNotifier) {
    this.notifyCancel = notifyCancel;
  }

  add(id: jsonrpcTypes.JsonRpcId, entry: pendingRequestsTypes.PendingRequest): void {
    this.pending.set(id, entry);
    if (entry.progressToken !== undefined) this.progressRequests.set(entry.progressToken, id);
    entry.signal?.addEventListener("abort", entry.onAbort, { once: true });
    this.armTimeout(id, entry);
  }

  resolve(
    id: jsonrpcTypes.JsonRpcId,
    outcome: Effect.Effect<unknown, foreignTypes.McpForeignError>,
  ): boolean {
    const entry = this.pending.get(id);
    if (entry === undefined) return false;
    this.remove(id, entry);
    Deferred.doneUnsafe(entry.deferred, outcome);
    return true;
  }

  progress(token: jsonrpcTypes.JsonRpcId): pendingRequestsTypes.PendingRequest | undefined {
    const requestId = this.progressRequests.get(token);
    const entry = requestId === undefined ? undefined : this.pending.get(requestId);
    if (requestId === undefined || entry === undefined) return undefined;
    this.armTimeout(requestId, entry);
    return entry;
  }

  cancel(id: jsonrpcTypes.JsonRpcId, error: unknown, notifyServer: boolean, reason?: string): void {
    if (!this.resolve(id, Effect.fail(foreign(error)))) return;
    if (notifyServer) this.notifyCancel(id, reason);
  }

  rejectAll(error: unknown): void {
    for (const [id, entry] of this.pending) {
      this.remove(id, entry);
      Deferred.doneUnsafe(entry.deferred, Effect.fail(foreign(error)));
    }
  }

  private armTimeout(id: jsonrpcTypes.JsonRpcId, entry: pendingRequestsTypes.PendingRequest): void {
    entry.timer?.interruptUnsafe();
    entry.timer = undefined;
    if (!Number.isFinite(entry.timeoutMs) || entry.timeoutMs <= 0) return;
    const timedOut = Effect.sync(() => {
      this.cancel(id, new McpTimeoutError(entry.timeoutMs), entry.cancellable, "Request timed out");
    });
    entry.timer = Effect.runFork(Effect.delay(timedOut, entry.timeoutMs));
  }

  private remove(id: jsonrpcTypes.JsonRpcId, entry: pendingRequestsTypes.PendingRequest): void {
    this.pending.delete(id);
    entry.timer?.interruptUnsafe();
    if (entry.progressToken !== undefined) this.progressRequests.delete(entry.progressToken);
    entry.signal?.removeEventListener("abort", entry.onAbort);
    entry.sendController.abort();
  }
}
