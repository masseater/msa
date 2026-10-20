import type { Effect } from "effect";

import type typesModule from "./types.ts";

declare namespace supportTypes {
  type ConformanceTest = (fixture: typesModule.TelemetryAdapterFixture) => Effect.Effect<void>;

  interface ConformanceCaseDefinition {
    readonly group: string;
    readonly name: string;
    readonly test: ConformanceTest;
  }
}

export type { supportTypes as default };
