import type { Deferred } from "effect";

import type orchestratorTypesTypes from "./types.types.ts";

declare namespace replanTypes {
  interface Entry {
    input: orchestratorTypesTypes.ReplanTaskInput;
    from: readonly string[];
    key: string | null;
  }

  interface Redirect {
    taskId: string;
    add: readonly string[];
    remove: readonly string[];
  }

  interface Prepared {
    input: orchestratorTypesTypes.ReplanInput;
    entries: readonly Entry[];
    keep: readonly string[];
    drop: readonly orchestratorTypesTypes.ReplanDropInput[];
    rewire: readonly orchestratorTypesTypes.ReplanRewireInput[];
    sources: readonly string[];
    views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>;
    memos: ReadonlyMap<string, Deferred.Deferred<string, string>>;
  }
}

export type { replanTypes as default };
