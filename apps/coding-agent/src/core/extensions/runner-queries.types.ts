import type RunnerQueriesClass from "./runner-queries.ts";

declare namespace runnerQueriesTypes {
  type RunnerQueries = (typeof RunnerQueriesClass)["prototype"];
}

export type { runnerQueriesTypes as default };
