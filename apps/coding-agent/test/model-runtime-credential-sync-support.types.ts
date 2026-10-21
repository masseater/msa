import type { Effect } from "effect";

declare namespace modelRuntimeCredentialSyncSupportTypes {
  interface Gate {
    readonly promise: Effect.Effect<void>;
    open(): void;
  }
}

export type { modelRuntimeCredentialSyncSupportTypes as default };
