import type envTypes from "../env/index.types.ts";
import type sessionTypes from "../session/session.types.ts";
import type harnessWiringTypes from "./harness-wiring.types.ts";
import type typesModule from "./types.types.ts";

declare namespace harnessQueriesTypes {
  type QuerySession = {
    readonly session: sessionTypes.SessionImpl;
    readonly storage: typesModule.Storage;
  };

  type BuiltEnv = envTypes.ExecutionEnv | undefined;

  type AgentQuery<Tool extends typesModule.ToolRegistration> = {
    readonly session: sessionTypes.SessionImpl;
    readonly options: typesModule.HarnessOptions<Tool>;
    readonly report: (error: unknown) => void;
  };

  type ExecutionEnv = envTypes.ExecutionEnv;

  type Wired = harnessWiringTypes.Wired;
}

export type { harnessQueriesTypes as default };
