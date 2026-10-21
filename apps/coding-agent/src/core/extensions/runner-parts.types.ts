import type ContextFactory from "./runner-context.ts";
import type runnerContextTypes from "./runner-context.types.ts";
import type RunnerEmitApi from "./runner-emit-api.ts";
import type RunnerErrors from "./runner-errors.ts";
import type runnerInvokerTypes from "./runner-invoker.types.ts";
import type RunnerQueries from "./runner-queries.ts";
import type runnerQueriesTypes from "./runner-queries.types.ts";
import type UIPromptTracker from "./runner-ui-prompts.ts";

declare namespace runnerPartsTypes {
  interface PartsSource {
    readonly context: runnerContextTypes.ContextHost;
    readonly events: runnerInvokerTypes.EmitHost;
    readonly queries: runnerQueriesTypes.QuerySource;
    readonly onPromptEvent: ConstructorParameters<typeof UIPromptTracker>[0];
  }

  interface RunnerParts {
    readonly contextFactory: ContextFactory;
    readonly errors: RunnerErrors;
    readonly events: RunnerEmitApi;
    readonly prompts: UIPromptTracker;
    readonly queries: RunnerQueries;
  }
}

export type { runnerPartsTypes as default };
