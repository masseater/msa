import { type Models, fauxAssistantMessage } from "@msa/ai";
import {
  type CommitPublication,
  type Conversation,
  LiveDoc,
  type LiveState,
  type TaskId,
} from "@msa/durable";
import { Harness } from "@msa/durable/harness";
import { Effect, Stream } from "effect";
import { dual } from "effect/Function";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { waitFor } = chatSupport;
const { awaited } = effectSupport;
const { context } = sessionSupport;

function heldStreamImpl(start: unknown, final: unknown): ReturnType<Models["streamSimple"]> {
  const events = Stream.concat(Stream.make(start), Stream.fromEffectDrain(Effect.sleep(300)));
  return {
    [Symbol.asyncIterator]: () => Stream.toAsyncIterable(events)[Symbol.asyncIterator](),
    result: () => Promise.resolve(final),
  } as unknown as ReturnType<Models["streamSimple"]>;
}

const heldStream: {
  (final: unknown): (start: unknown) => ReturnType<typeof heldStreamImpl>;
  (start: unknown, final: unknown): ReturnType<typeof heldStreamImpl>;
} = dual(2, heldStreamImpl);

const invalidFinalStream = (): ReturnType<Models["streamSimple"]> =>
  heldStream(
    { partial: fauxAssistantMessage("partial", { stopReason: "pending" }), type: "start" },
    { ...fauxAssistantMessage("final"), invalid: () => {} },
  );

const ERROR_503 = fauxAssistantMessage([], {
  errorMessage: "503 Service Unavailable",
  stopReason: "error",
});

function liveImpl(
  harness: Harness,
  conversation: Conversation,
): Promise<Readonly<LiveState> | undefined> {
  return Promise.resolve(harness.snapshot(LiveDoc, conversation.id, context));
}

const live: {
  (conversation: Conversation): (harness: Harness) => ReturnType<typeof liveImpl>;
  (harness: Harness, conversation: Conversation): ReturnType<typeof liveImpl>;
} = dual(2, liveImpl);

const runTask = Effect.fn("runTask")(function* (harness: Harness, conversation: Conversation) {
  let taskId: TaskId | undefined;
  yield* waitFor(
    Effect.gen(function* () {
      taskId = (yield* awaited(live(harness, conversation)))?.run?.taskId;
      return taskId !== undefined;
    }),
  );
  return taskId!;
});

function withStreamImpl(models: Models, streamSimple: Models["streamSimple"]): Models {
  return new Proxy(models, {
    get(target, property) {
      if (property === "streamSimple") return streamSimple;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const withStream: {
  (streamSimple: Models["streamSimple"]): (models: Models) => ReturnType<typeof withStreamImpl>;
  (models: Models, streamSimple: Models["streamSimple"]): ReturnType<typeof withStreamImpl>;
} = dual(2, withStreamImpl);

function livePublications(harness: Harness): LiveState[] {
  const values: LiveState[] = [];
  harness.subscribeCommits((publication: CommitPublication) => {
    for (const change of publication.changes) {
      if (
        change.type === "document" &&
        change.record.kind === "msa.live" &&
        change.value !== null
      ) {
        values.push(change.value as LiveState);
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
