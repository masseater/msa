import type { Effect } from "effect";

declare namespace platformTypes {
  interface BytesWrite {
    readonly path: string;
    readonly data: Uint8Array;
  }

  interface Background {
    readonly stop: Effect.Effect<void>;
  }
}

export type { platformTypes as default };
