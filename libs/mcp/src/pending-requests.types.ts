import type { Deferred, Fiber } from "effect";

import type foreignTypes from "./foreign.types.ts";
import type PendingRequestsClass from "./pending-requests.ts";
import type jsonrpcTypes from "./protocol/jsonrpc.types.ts";
import type typesModule from "./protocol/types.types.ts";

declare namespace pendingRequestsTypes {
  interface PendingRequest {
    deferred: Deferred.Deferred<unknown, foreignTypes.McpForeignError>;
    timeoutMs: number;
    timer: Fiber.Fiber<void> | undefined;
    signal: AbortSignal | undefined;
    onAbort: () => void;
    sendController: AbortController;
    cancellable: boolean;
    onProgress: ((progress: typesModule.ProgressNotification) => void) | undefined;
    progressToken: jsonrpcTypes.JsonRpcId | undefined;
  }

  type CancelNotifier = (id: jsonrpcTypes.JsonRpcId, reason: string | undefined) => void;

  type PendingRequests = PendingRequestsClass;
}

export type { pendingRequestsTypes as default };
