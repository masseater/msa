import type { Effect } from "effect";

declare namespace modelRegistrySupportTypes {
  interface Gate {
    readonly promise: Effect.Effect<void>;
    open(): void;
  }
}

export type { modelRegistrySupportTypes as default };
