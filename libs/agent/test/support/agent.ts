import { createAssistantMessageEventStream, type TranscriptContext } from "@msa/ai";
import { Deferred, Effect } from "effect";

import type { StreamFn } from "../../src/types.ts";
import { textMessage } from "./fixtures.ts";

export const unusedStreamFunction = (): StreamFn => () => {
  throw new Error("Unexpected stream call");
};

export const awaitDeferred = (deferred: Deferred.Deferred<void>): Promise<void> =>
  Effect.runPromise(Deferred.await(deferred));

export const release = (deferred: Deferred.Deferred<void>): void => {
  Deferred.doneUnsafe(deferred, Effect.void);
};

const waitForAbort = (signal: AbortSignal | undefined): Effect.Effect<void> =>
  Effect.suspend(() =>
    signal?.aborted === true ? Effect.void : Effect.andThen(Effect.sleep(5), waitForAbort(signal)),
  );

export const abortableStream = (): StreamFn => (_model, _context, options) => {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: textMessage("") });
    Effect.runFork(
      Effect.andThen(
        waitForAbort(options?.signal),
        Effect.sync(() => {
          stream.push({ type: "error", reason: "aborted", error: textMessage("Aborted") });
        }),
      ),
    );
  });
  return stream;
};

export const userTexts = (context: TranscriptContext): string[] =>
  context.messages.flatMap((message) =>
    message.role === "user" && typeof message.content === "string" ? [message.content] : [],
  );
