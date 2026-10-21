import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import bridge from "./bridge.ts";
import generationClassify from "./generation-classify.ts";
import generationFail from "./generation-fail.ts";
import generationRun from "./generation-run.ts";
import generationStream from "./generation-stream.ts";
import type generationTypesModule from "./generation-types.types.ts";
import liveModule from "./live.ts";
import type typesModule from "./types.types.ts";

const { commitTask } = bridge;
const { LiveDoc } = liveModule;
const { failNoModel } = generationFail;
const { replaceMessages, requestOptions, streamResponse } = generationStream;
const requestPhase = Effect.fnUntraced(function* (
  task: generationTypesModule.PhaseTask<"request">,
  runtime: generationTypesModule.GenerationRuntime,
  context: chordTypes.Context,
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
    (tx: typesModule.Tx) =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        yield* generationRun.convertPartial(tx, live, conversationId);
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
  const request = { attempt, compacted, cutoff, messages: view.messages, model: ref };
  yield* generationClassify.classify(runtime, request, message, context);
});

const generationRequest = {
  requestPhase,
};

export default generationRequest;
