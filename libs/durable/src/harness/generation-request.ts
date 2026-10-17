import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { commitTask } from "./bridge.ts";
import { classify } from "./generation-classify.ts";
import { failNoModel } from "./generation-fail.ts";
import { convertPartial } from "./generation-run.ts";
import { replaceMessages, requestOptions, streamResponse } from "./generation-stream.ts";
import type { GenerationRuntime, PhaseTask } from "./generation-types.ts";
import { LiveDoc } from "./live.ts";
import type { Tx } from "./types.ts";

export const requestPhase = Effect.fn("requestPhase")(function* (
  task: PhaseTask<"request">,
  runtime: GenerationRuntime,
  context: Context,
) {
  const {
    attempt,
    compacted,
    model: ref,
    thinkingLevel,
    streamOptions,
    cutoff,
  } = task.state.checkpoint;
  const { conversationId } = runtime;
  yield* commitTask(
    runtime,
    (tx: Tx) =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        yield* convertPartial(tx, live, conversationId);
        live.generation = { attempt };
        return undefined;
      }),
    context,
  );
  const model = runtime.models.getModel(ref.provider, ref.modelId);
  if (model === undefined) return yield* failNoModel(runtime, ref, context);
  const view = yield* Effect.promise(() =>
    runtime.context(conversationId, context, { at: cutoff }),
  );
  const messages = yield* replaceMessages(runtime, view.messages, context);
  const options = yield* requestOptions(runtime, streamOptions, thinkingLevel, context);
  const message = yield* streamResponse(runtime, model, messages, options, attempt, context);
  const request = { attempt, compacted, model: ref, cutoff, messages: view.messages };
  yield* classify(runtime, request, message, context);
});
