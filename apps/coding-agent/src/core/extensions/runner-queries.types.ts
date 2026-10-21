import type modelRegistryTypes from "../model-registry.types.ts";
import type RunnerQueriesClass from "./runner-queries.ts";
import type extensionsTypesTypes from "./types.types.ts";

declare namespace runnerQueriesTypes {
  type RunnerQueries = (typeof RunnerQueriesClass)["prototype"];

  interface QuerySource {
    readonly extensions: extensionsTypesTypes.Extension[];
    readonly runtime: extensionsTypesTypes.ExtensionRuntime;
    readonly modelRegistry: modelRegistryTypes.ModelRegistry;
    readonly hasUI: () => boolean;
  }
}

export type { runnerQueriesTypes as default };
