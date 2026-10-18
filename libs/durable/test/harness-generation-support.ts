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

import { waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";

export const heldStream = (start: unknown, final: unknown): ReturnType<Models["streamSimple"]> => {
  const events = Stream.concat(Stream.make(start), Stream.fromEffectDrain(Effect.sleep(300)));
  return {
    [Symbol.asyncIterator]: () => Stream.toAsyncIterable(events)[Symbol.asyncIterator](),
    result: () => Promise.resolve(final),
  } as unknown as ReturnType<Models["streamSimple"]>;
};

export const invalidFinalStream = (): ReturnType<Models["streamSimple"]> =>
  heldStream(
    { type: "start", partial: fauxAssistantMessage("partial", { stopReason: "pending" }) },
    { ...fauxAssistantMessage("final"), invalid: () => {} },
  );

export const ERROR_503 = fauxAssistantMessage([], {
  stopReason: "error",
  errorMessage: "503 Service Unavailable",
});

export function live(
  harness: Harness,
  conversation: Conversation,
): Promise<Readonly<LiveState> | undefined> {
  return Promise.resolve(harness.snapshot(LiveDoc, conversation.id, context));
}

export const runTask = Effect.fn("runTask")(function* (
  harness: Harness,
  conversation: Conversation,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let taskId: TaskId | undefined;
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        taskId = (yield* awaited(live(harness, conversation)))?.run?.taskId;
        return taskId !== undefined;
      }),
    ),
  );
  return taskId!;
});

export function withStream(models: Models, streamSimple: Models["streamSimple"]): Models {
  return new Proxy(models, {
    get(target, property) {
      if (property === "streamSimple") return streamSimple;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

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
