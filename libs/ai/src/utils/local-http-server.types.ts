import type { Effect } from "effect";

declare namespace localHttpServerTypes {
  interface LocalHttpRequest {
    readonly method: string;
    readonly url: URL;
  }

  interface LocalHttpResponse {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }

  interface LocalHttpServer {
    readonly port: number;
    readonly close: Effect.Effect<void>;
  }

  interface LocalHttpServerOptions {
    readonly host: string;
    readonly port: number;
    readonly baseUrl: string;
    readonly handle: (
      request: LocalHttpRequest,
      reply: (response: LocalHttpResponse) => Effect.Effect<void>,
    ) => Effect.Effect<void>;
    readonly onError: (error: Error) => Effect.Effect<void>;
    readonly closeConnections: boolean;
  }
}

export type { localHttpServerTypes as default };
