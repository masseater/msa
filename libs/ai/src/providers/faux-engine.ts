import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import eventStream from "../utils/event-stream.ts";
import type fauxEngineTypes from "./faux-engine.types.ts";
import fauxMessages from "./faux-messages.ts";
import type fauxMessagesTypes from "./faux-messages.types.ts";
import fauxUsage from "./faux-usage.ts";

const { withUsageEstimate } = fauxUsage;
const { errorMessage, stampMessage } = fauxMessages;
const { createAssistantMessageEventStream } = eventStream;

const originOf =
  (engine: fauxEngineTypes.FauxEngine) =>
  (model: typesModule.Model<string>): fauxMessagesTypes.FauxOrigin => ({
    api: engine.api,
    modelId: model.id,
    provider: engine.provider,
  });

const resolveFauxResponse = Effect.fn("resolveFauxResponse")(function* ({
  engine,
  step,
  context,
  options,
  model,
}: fauxEngineTypes.FauxResponseRequest) {
  const resolved =
    typeof step === "function"
      ? yield* Effect.promise(() => Promise.resolve(step(context, options, engine.state, model)))
      : step;
  return withUsageEstimate({
    context,
    message: stampMessage({ message: resolved, origin: originOf(engine)(model) }),
    options,
    promptCache: engine.promptCache,
  });
});

const endWithError =
  (stream: typesModule.AssistantMessageEventStream) =>
  (message: typesModule.AssistantMessage): void => {
    stream.push({ error: message, reason: "error", type: "error" });
    stream.end(message);
  };

function streamDetached({
  engine,
  model,
  run,
}: fauxEngineTypes.DetachedStream): typesModule.AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    Effect.runFork(
      run(stream).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() =>
            endWithError(stream)(errorMessage({ error, origin: originOf(engine)(model) })),
          ),
        ),
      ),
    );
  });
  return stream;
}

const fauxEngine = {
  endWithError,
  originOf,
  resolveFauxResponse,
  streamDetached,
};

export default fauxEngine;
