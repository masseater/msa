import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import durable from "@msa/durable";
import type harnessTypes from "@msa/durable/harness.types";
import type durableTypes from "@msa/durable/index.types";
import { Effect, Stream } from "effect";
import { dual } from "effect/Function";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { fauxAssistantMessage } = ai;

const { LiveDoc } = durable;

const { waitFor } = chatSupport;
const { awaited } = effectSupport;
const { context } = sessionSupport;

function heldStreamImpl(
  start: unknown,
  final: unknown,
): ReturnType<aiTypes.Models["streamSimple"]> {
  const events = Stream.concat(Stream.make(start), Stream.fromEffectDrain(Effect.sleep(300)));
  return {
    [Symbol.asyncIterator]: () => Stream.toAsyncIterable(events)[Symbol.asyncIterator](),
    result: () => Promise.resolve(final),
  } as unknown as ReturnType<aiTypes.Models["streamSimple"]>;
}

const heldStream: {
  (final: unknown): (start: unknown) => ReturnType<typeof heldStreamImpl>;
  (start: unknown, final: unknown): ReturnType<typeof heldStreamImpl>;
} = dual(2, heldStreamImpl);

const invalidFinalStream = (): ReturnType<aiTypes.Models["streamSimple"]> =>
  heldStream(
    { partial: fauxAssistantMessage("partial", { stopReason: "pending" }), type: "start" },
    { ...fauxAssistantMessage("final"), invalid: () => {} },
  );

const ERROR_503 = fauxAssistantMessage([], {
  errorMessage: "503 Service Unavailable",
  stopReason: "error",
});

function liveImpl(
  harness: harnessTypes.Harness,
  conversation: durableTypes.Conversation,
): Promise<Readonly<durableTypes.LiveState> | undefined> {
  return Promise.resolve(harness.snapshot(LiveDoc, conversation.id, context));
}

const live: {
  (
    conversation: durableTypes.Conversation,
  ): (harness: harnessTypes.Harness) => ReturnType<typeof liveImpl>;
  (
    harness: harnessTypes.Harness,
    conversation: durableTypes.Conversation,
  ): ReturnType<typeof liveImpl>;
} = dual(2, liveImpl);

const runTask = Effect.fn("runTask")(function* (
  harness: harnessTypes.Harness,
  conversation: durableTypes.Conversation,
) {
  let taskId: durableTypes.TaskId | undefined;
  yield* waitFor(
    Effect.gen(function* () {
      taskId = (yield* awaited(live(harness, conversation)))?.run?.taskId;
      return taskId !== undefined;
    }),
  );
  return taskId!;
});

function withStreamImpl(
  models: aiTypes.Models,
  streamSimple: aiTypes.Models["streamSimple"],
): aiTypes.Models {
  return new Proxy(models, {
    get(target, property) {
      if (property === "streamSimple") return streamSimple;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const withStream: {
  (
    streamSimple: aiTypes.Models["streamSimple"],
  ): (models: aiTypes.Models) => ReturnType<typeof withStreamImpl>;
  (
    models: aiTypes.Models,
    streamSimple: aiTypes.Models["streamSimple"],
  ): ReturnType<typeof withStreamImpl>;
} = dual(2, withStreamImpl);

function livePublications(harness: harnessTypes.Harness): durableTypes.LiveState[] {
  const values: durableTypes.LiveState[] = [];
  harness.subscribeCommits((publication: durableTypes.CommitPublication) => {
    for (const change of publication.changes) {
      if (
        change.type === "document" &&
        change.record.kind === "msa.live" &&
        change.value !== null
      ) {
        values.push(change.value as durableTypes.LiveState);
      }
    }
  });
  return values;
}

const harnessGenerationSupport = {
  ERROR_503,
  heldStream,
  invalidFinalStream,
  live,
  livePublications,
  runTask,
  withStream,
};

export default harnessGenerationSupport;
