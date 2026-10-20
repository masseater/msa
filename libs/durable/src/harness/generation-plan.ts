import type { Context } from "@msa/chord";
import { Cause, Effect, Exit } from "effect";

import type envTypes from "../env/index.types.ts";
import type generationPlanTypes from "./generation-plan.types.ts";
import generationThreshold from "./generation-threshold.ts";
import type generationTypesModule from "./generation-types.types.ts";
import prompt from "./prompt.ts";
import type typesModule from "./types.types.ts";

const { planSystemEntries, renderSections, replaySections } = prompt;
const readEnv = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  context: Context,
) {
  const exit = yield* Effect.exit(Effect.promise(() => runtime.env(context)));
  if (Exit.isSuccess(exit)) return exit.value;
  const error = Cause.squash(exit.cause);
  if (context.abortSignal?.aborted === true) return yield* Effect.die(error);
  runtime.report(error);
  return undefined as envTypes.ExecutionEnv | undefined;
});

const planPrompt = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  agent: typesModule.Agent,
  compacted: boolean,
  contextWindow: number,
  context: Context,
) {
  const view = yield* Effect.promise(() => runtime.context(runtime.conversationId, context));
  const shown = replaySections(view.messages);
  const report = (error: unknown): void => {
    runtime.report(error);
  };
  const env = yield* readEnv(runtime, context);
  const input: typesModule.PromptInput = {
    agent,
    conversationId: runtime.conversationId,
    env,
    read: runtime,
    shown: Object.fromEntries(shown),
  };
  const desired = yield* renderSections(agent.sections, input, shown, report, context);
  const entries = planSystemEntries(view, desired, agent.tools, runtime.now());
  const threshold = compacted
    ? undefined
    : generationThreshold.thresholdCompaction(
        view,
        entries,
        contextWindow,
        runtime.settings.compaction,
      );
  return { entries, threshold } satisfies generationPlanTypes.PromptPlan;
});

const generationPlan = {
  planPrompt,
};

export default generationPlan;
