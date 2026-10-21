import type { Effect } from "effect";

declare namespace timingTypes {
  interface Latch<T = void> {
    readonly promise: Promise<T>;
    readonly wait: Effect.Effect<T>;
    readonly open: (value: T) => void;
  }
}

export type { timingTypes as default };
