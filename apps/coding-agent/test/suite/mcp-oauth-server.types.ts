import type { Deferred } from "effect";

declare namespace mcpOauthServerTypes {
  interface StalledRequest {
    path: string;
    request: Request;
  }

  interface ServerOptions {
    iss?: string;
    issParameter?: boolean;
    cimd?: boolean;
    redirectPath?: string;
  }

  interface ServerState {
    readonly options: ServerOptions;
    readonly log: string[];
    readonly registrations: Record<string, unknown>[];
    readonly authorizations: URLSearchParams[];
    readonly tokenRequests: URLSearchParams[];
    readonly deletes: (string | undefined)[];
    readonly stall: Set<string>;
    readonly stalled: StalledRequest[];
    readonly validTokens: Set<string>;
    readonly refreshTokens: Set<string>;
    readonly challenges: Map<string, string>;
    readonly closing: Deferred.Deferred<void>;
    issued: number;
    origin: string;
  }
}

export type { mcpOauthServerTypes as default };
