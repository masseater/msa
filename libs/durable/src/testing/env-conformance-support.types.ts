import type { Effect } from "effect";

import type envTypes from "../env/index.types.ts";
import type typesModule from "./types.ts";

declare namespace envConformanceSupportTypes {
  interface EnvSuite {
    readonly assert: typesModule.EnvConformanceAssertions;
    readonly shell: readonly string[];
  }

  interface EnvCaseSpec {
    readonly name: string;
    readonly timeoutMs?: number;
    readonly test: (env: envTypes.ExecutionEnv, suite: EnvSuite) => Effect.Effect<void>;
  }

  interface Watching {
    readonly changes: envTypes.WatchChange[];
    expectChange(path: string, change: Effect.Effect<void>): Effect.Effect<void>;
    absolute(path: string): Effect.Effect<string>;
  }
}

export type { envConformanceSupportTypes as default };
