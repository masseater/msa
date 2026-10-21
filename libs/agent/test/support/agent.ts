import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Deferred, Effect } from "effect";

import type typesModule from "../../src/types.ts";
import fixtures from "./fixtures.ts";

const { createAssistantMessageEventStream } = ai;

const { textMessage } = fixtures;

const unusedStreamFunction = (): typesModule.StreamFn => () => {
  throw new Error("Unexpected stream call");
};

const awaitDeferred = (deferred: Deferred.Deferred<void>): Promise<void> =>
  Effect.runPromise(Deferred.await(deferred));

const release = (deferred: Deferred.Deferred<void>): void => {
  Deferred.doneUnsafe(deferred, Effect.void);
};

const waitForAbort = (signal: AbortSignal | undefined): Effect.Effect<void> =>
  Effect.suspend(() =>
    signal?.aborted === true ? Effect.void : Effect.andThen(Effect.sleep(5), waitForAbort(signal)),
  );

const abortableStream = (): typesModule.StreamFn => (_model, _context, options) => {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ partial: textMessage(""), type: "start" });
    Effect.runFork(
      Effect.andThen(
        waitForAbort(options?.signal),
        Effect.sync(() => {
          stream.push({ error: textMessage("Aborted"), reason: "aborted", type: "error" });
        }),
      ),
    );
  });
  return stream;
};

const userTexts = (context: aiTypes.TranscriptContext): string[] =>
  context.messages.flatMap((message) =>
    message.role === "user" && typeof message.content === "string" ? [message.content] : [],
  );

const agent = {
  abortableStream,
  awaitDeferred,
  release,
  unusedStreamFunction,
  userTexts,
};

export default agent;
