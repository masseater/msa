import type IncomingRequestsClass from "./incoming-requests.ts";

declare namespace incomingRequestsTypes {
  type RequestHandler = (
    params: unknown,
    context: { signal: AbortSignal },
  ) => unknown | Promise<unknown>;

  type IncomingRequests = IncomingRequestsClass;
}

export type { incomingRequestsTypes as default };
