import type { Effect } from "effect";

declare namespace tempTypes {
  interface TrackedTempDirs {
    readonly cleanUp: Effect.Effect<void>;
    readonly make: (prefix: string) => Effect.Effect<string>;
  }

  interface TempFile {
    readonly directory: string;
    readonly path: string;
  }
}

export type { tempTypes as default };
