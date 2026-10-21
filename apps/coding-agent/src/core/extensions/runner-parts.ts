import ContextFactory from "./runner-context.ts";
import RunnerEmitApi from "./runner-emit-api.ts";
import RunnerErrors from "./runner-errors.ts";
import type runnerPartsTypes from "./runner-parts.types.ts";
import RunnerQueries from "./runner-queries.ts";
import UIPromptTracker from "./runner-ui-prompts.ts";

const createRunnerParts = (source: runnerPartsTypes.PartsSource): runnerPartsTypes.RunnerParts => ({
  contextFactory: new ContextFactory(source.context),
  errors: new RunnerErrors(),
  events: new RunnerEmitApi(source.events),
  prompts: new UIPromptTracker(source.onPromptEvent),
  queries: new RunnerQueries(source.queries),
});

const runnerParts = { createRunnerParts };

export default runnerParts;
