import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";
import jsonModule from "@msa/chord/json";
import { Cause, Effect, Fiber } from "effect";

import bridge from "./bridge.ts";
import type generationTypesModule from "./generation-types.types.ts";
import json from "./json.ts";
import liveModule from "./live.ts";
import provider from "./provider.ts";

const { copyJson } = jsonModule;

const { commitTask, eachHook, hookResult } = bridge;
const { LiveDoc } = liveModule;
const { assignJson } = json;
const { ensureProviderSessionId } = provider;

type Partials = {
  pending: aiTypes.AssistantMessage | undefined;
  stopped: boolean;
};

const storePartial = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  attempt: number,
  partial: aiTypes.AssistantMessage,
  context: chordTypes.Context,
) {
  const message = copyJson(partial, { omitUndefinedProperties: true });
  yield* commitTask(
    runtime,
    (tx) =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        live.generation ??= { attempt };
        assignJson(
          live.generation as chordTypes.Draft<Record<string, chordTypes.JsonValue>>,
          "message",
          message,
        );
        return undefined;
      }),
    context,
  );
});

const flushPartials = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  partials: Partials,
  attempt: number,
  context: chordTypes.Context,
) {
  const interval = runtime.settings.progress.partialIntervalMs;
  while (!partials.stopped) {
    yield* Effect.sleep(interval);
    if (partials.stopped) return;
    const partial = partials.pending;
    partials.pending = undefined;
    if (partial === undefined) continue;
    yield* Effect.uninterruptible(
      Effect.catchCause(storePartial(runtime, attempt, partial, context), (cause) =>
        Effect.sync(() => {
          if (!runtime.signal.aborted) runtime.report(Cause.squash(cause));
        }),
      ),
    );
  }
});

const consumeEvents = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  model: aiTypes.Model<aiTypes.Api>,
  messages: readonly aiTypes.Message[],
  options: aiTypes.SimpleStreamOptions,
  partials: Partials,
) {
  const events = runtime.models.streamSimple(model, { messages: [...messages] }, options);
  const iterator = events[Symbol.asyncIterator]();
  let event = yield* Effect.promise(() => iterator.next());
  while (event.done !== true) {
    const value = event.value;
    if (value.type !== "done" && value.type !== "error" && value.partial.content.length > 0)
      partials.pending = value.partial;
    event = yield* Effect.promise(() => iterator.next());
  }
  return yield* Effect.promise(() => events.result());
});

const streamResponse = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  model: aiTypes.Model<aiTypes.Api>,
  messages: readonly aiTypes.Message[],
  options: aiTypes.SimpleStreamOptions,
  attempt: number,
  context: chordTypes.Context,
) {
  const partials: Partials = { pending: undefined, stopped: false };
  const flushing = yield* Effect.forkChild(flushPartials(runtime, partials, attempt, context));
  return yield* Effect.ensuring(
    consumeEvents(runtime, model, messages, options, partials),
    Effect.suspend(() => {
      partials.stopped = true;
      return Fiber.interrupt(flushing);
    }),
  );
});

const replaceMessages = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  initial: GenerationRuntimeMessages,
  context: chordTypes.Context,
) {
  let messages = initial;
  yield* eachHook(runtime.hooks, "beforeRequest", (hook) =>
    Effect.map(
      hookResult(() => hook({ messages }, runtime, context)),
      (replaced) => {
        if (replaced !== undefined) messages = replaced.messages;
      },
    ),
  );
  return messages;
});

type GenerationRuntimeMessages = Awaited<
  ReturnType<generationTypesModule.GenerationRuntime["context"]>
>["messages"];

const requestOptions = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  streamOptions: Extract<
    generationTypesModule.GenerationCheckpoint,
    { phase: "request" }
  >["streamOptions"],
  thinkingLevel: Extract<
    generationTypesModule.GenerationCheckpoint,
    { phase: "request" }
  >["thinkingLevel"],
  context: chordTypes.Context,
) {
  return {
    ...streamOptions,
    sessionId: yield* ensureProviderSessionId(runtime, context),
    signal: runtime.signal,
    ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
  };
});

const generationStream = {
  replaceMessages,
  requestOptions,
  streamResponse,
};

export default generationStream;
