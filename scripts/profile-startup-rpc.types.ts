import type { Effect, Ref } from "effect";

declare namespace profileStartupRpcTypes {
  interface RpcState {
    readonly readyElapsedMs: number | undefined;
    readonly responseError: string | undefined;
  }

  interface LineContext {
    readonly onReady: Effect.Effect<void>;
    readonly requestId: string;
    readonly startedAt: number;
    readonly state: Ref.Ref<RpcState>;
  }
}

export type { profileStartupRpcTypes as default };
