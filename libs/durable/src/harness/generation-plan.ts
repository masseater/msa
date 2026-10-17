import type { Context } from "@msa/chord";
import { Cause, Effect, Exit } from "effect";

import type { ExecutionEnv } from "../env/index.ts";
import { thresholdCompaction, type ThresholdOutcome } from "./generation-threshold.ts";
import type { GenerationRuntime } from "./generation-types.ts";
import { planSystemEntries, renderSections, replaySections, type SystemDraft } from "./prompt.ts";
import type { Agent, PromptInput } from "./types.ts";

export type PromptPlan = {
  readonly entries: readonly SystemDraft[];
  readonly threshold: ThresholdOutcome;
};

const readEnv = Effect.fnUntraced(function* (runtime: GenerationRuntime, context: Context) {
  const exit = yield* Effect.exit(Effect.promise(() => runtime.env(context)));
  if (Exit.isSuccess(exit)) return exit.value;
  const error = Cause.squash(exit.cause);
  if (context.abortSignal?.aborted === true) return yield* Effect.die(error);
  runtime.report(error);
  return undefined as ExecutionEnv | undefined;
});

export const planPrompt = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  agent: Agent,
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
  const input: PromptInput = {
    conversationId: runtime.conversationId,
    agent,
    env,
    shown: Object.fromEntries(shown),
    read: runtime,
  };
  const desired = yield* renderSections(agent.sections, input, shown, report, context);
  const entries = planSystemEntries(view, desired, agent.tools, runtime.now());
  const threshold = compacted
    ? undefined
    : thresholdCompaction(view, entries, contextWindow, runtime.settings.compaction);
  return { entries, threshold } satisfies PromptPlan;
});
