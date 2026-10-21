import type harnessImpl from "./harness-impl.ts";
import type harnessQueriesTypes from "./harness-queries.types.ts";
import type harnessWiringTypes from "./harness-wiring.types.ts";
import type typesModule from "./types.types.ts";

declare namespace harnessImplTypes {
  type HarnessImpl<Tool extends typesModule.ToolRegistration> = InstanceType<
    typeof harnessImpl.HarnessImpl<Tool>
  >;

  type BuiltEnv = harnessQueriesTypes.BuiltEnv;

  type Wired = harnessWiringTypes.Wired;
}

export type { harnessImplTypes as default };
