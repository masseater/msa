import type { Effect } from "effect";

import type typesModule from "../types.ts";

declare namespace callbackServerTypes {
  interface OAuthCallbackServerOptions<T> {
    readonly providerName: string;
    readonly host: string;
    readonly port: number;
    readonly path: string;
    readonly redirectHost?: string;
    readonly state?: string | undefined;
    readonly complete: (code: string) => Effect.Effect<T>;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  }

  interface OAuthCallbackServer<T> {
    readonly redirectUri: string;
    readonly wait: Effect.Effect<T | undefined>;
    readonly cancel: Effect.Effect<void>;
    readonly close: Effect.Effect<void>;
  }

  interface CallbackOrManualInputOptions<T> {
    readonly interaction: typesModule.ProviderAuthInteraction;
    readonly callback: OAuthCallbackServer<T> | undefined;
    readonly message: string;
    readonly placeholder: string;
  }

  type CallbackOrManualInput<T> =
    | { readonly type: "callback"; readonly value: T }
    | { readonly type: "manual"; readonly input: string };
}

export type { callbackServerTypes as default };
