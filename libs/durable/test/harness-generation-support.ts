import { fauxAssistantMessage, type Models } from "@msa/ai";
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

import { waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";

function heldStreamImpl(start: unknown, final: unknown): ReturnType<Models["streamSimple"]> {
  const events = Stream.concat(Stream.make(start), Stream.fromEffectDrain(Effect.sleep(300)));
  return {
    [Symbol.asyncIterator]: () => Stream.toAsyncIterable(events)[Symbol.asyncIterator](),
    result: () => Promise.resolve(final),
  } as unknown as ReturnType<Models["streamSimple"]>;
}

export const heldStream: {
  (final: unknown): (start: unknown) => ReturnType<typeof heldStreamImpl>;
  (start: unknown, final: unknown): ReturnType<typeof heldStreamImpl>;
} = dual(2, heldStreamImpl);

export const invalidFinalStream = (): ReturnType<Models["streamSimple"]> =>
  heldStream(
    { type: "start", partial: fauxAssistantMessage("partial", { stopReason: "pending" }) },
    { ...fauxAssistantMessage("final"), invalid: () => {} },
  );

export const ERROR_503 = fauxAssistantMessage([], {
  stopReason: "error",
  errorMessage: "503 Service Unavailable",
});

function liveImpl(
  harness: Harness,
  conversation: Conversation,
): Promise<Readonly<LiveState> | undefined> {
  return Promise.resolve(harness.snapshot(LiveDoc, conversation.id, context));
}

export const live: {
  (conversation: Conversation): (harness: Harness) => ReturnType<typeof liveImpl>;
  (harness: Harness, conversation: Conversation): ReturnType<typeof liveImpl>;
} = dual(2, liveImpl);

export const runTask = Effect.fn("runTask")(function* (
  harness: Harness,
  conversation: Conversation,
) {
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

export const withStream: {
  (streamSimple: Models["streamSimple"]): (models: Models) => ReturnType<typeof withStreamImpl>;
  (models: Models, streamSimple: Models["streamSimple"]): ReturnType<typeof withStreamImpl>;
} = dual(2, withStreamImpl);

export function livePublications(harness: Harness): LiveState[] {
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
