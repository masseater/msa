import type { Effect } from "effect";

declare namespace httpTypes {
  interface HttpRequest {
    readonly url: string | URL;
    readonly method?: "GET" | "POST" | undefined;
    readonly headers?: Readonly<Record<string, string>> | undefined;
    readonly body?: string | undefined;
    readonly signal?: AbortSignal | undefined;
  }

  interface HttpReply {
    readonly status: number;
    readonly ok: boolean;
    readonly header: (name: string) => string | undefined;
    readonly text: Effect.Effect<string>;
    readonly json: Effect.Effect<unknown>;
  }
}

export type { httpTypes as default };
