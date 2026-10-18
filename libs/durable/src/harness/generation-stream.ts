import type { Api, AssistantMessage, Message, Model, SimpleStreamOptions } from "@msa/ai";
import type { Context, Draft, JsonValue } from "@msa/chord";
import { copyJson } from "@msa/chord/json";
import { Cause, Effect, Fiber } from "effect";

import { commitTask, eachHook, hookResult } from "./bridge.ts";
import type { GenerationCheckpoint, GenerationRuntime } from "./generation-types.ts";
import { assignJson } from "./json.ts";
import { LiveDoc } from "./live.ts";
import { ensureProviderSessionId } from "./provider.ts";

type Partials = {
  pending: AssistantMessage | undefined;
  stopped: boolean;
};

const storePartial = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  attempt: number,
  partial: AssistantMessage,
  context: Context,
) {
  const message = copyJson(partial, { omitUndefinedProperties: true });
  yield* commitTask(
    runtime,
    (tx) =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        live.generation ??= { attempt };
        assignJson(live.generation as Draft<Record<string, JsonValue>>, "message", message);
        return undefined;
      }),
    context,
  );
});

const flushPartials = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  partials: Partials,
  attempt: number,
  context: Context,
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
  runtime: GenerationRuntime,
  model: Model<Api>,
  messages: readonly Message[],
  options: SimpleStreamOptions,
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

export const streamResponse = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  model: Model<Api>,
  messages: readonly Message[],
  options: SimpleStreamOptions,
  attempt: number,
  context: Context,
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

export const replaceMessages = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  initial: GenerationRuntimeMessages,
  context: Context,
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

type GenerationRuntimeMessages = Awaited<ReturnType<GenerationRuntime["context"]>>["messages"];

export const requestOptions = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  streamOptions: Extract<GenerationCheckpoint, { phase: "request" }>["streamOptions"],
  thinkingLevel: Extract<GenerationCheckpoint, { phase: "request" }>["thinkingLevel"],
  context: Context,
) {
  return {
    ...streamOptions,
    signal: runtime.signal,
    sessionId: yield* ensureProviderSessionId(runtime, context),
    ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
  };
});
