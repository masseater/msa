import { Clock, Effect, Function, Stream } from "effect";

import type typesModule from "../types.types.ts";
import errors from "../utils/errors.ts";
import eventStream from "../utils/event-stream.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type lazyTypes from "./lazy.types.ts";

const { toErrorMessage } = errors;
const { AssistantMessageEventStream } = eventStream;

const createSetupErrorMessage = (
  model: typesModule.Model<typesModule.Api>,
  error: unknown,
  timestamp: number,
): typesModule.AssistantMessage => ({
  api: model.api,
  content: [],
  errorMessage: toErrorMessage(error),
  model: model.id,
  provider: model.provider,
  role: "assistant",
  stopReason: "error",
  timestamp,
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
  },
});

const hasResult = (
  source: AsyncIterable<typesModule.AssistantMessageEvent>,
): source is AsyncIterable<typesModule.AssistantMessageEvent> & {
  result(): Promise<typesModule.AssistantMessage>;
} => typeof (source as { result?: unknown }).result === "function";

const forwardStream = (
  target: eventStreamTypes.AssistantMessageEventStream,
  source: AsyncIterable<typesModule.AssistantMessageEvent>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Stream.fromAsyncIterable(source, (error) => error).pipe(
      Stream.orDie,
      Stream.runForEach((event) => Effect.sync(() => target.push(event))),
    );
    target.end(hasResult(source) ? yield* Effect.promise(() => source.result()) : undefined);
  });

type StreamSetup = () =>
  | Promise<AsyncIterable<typesModule.AssistantMessageEvent>>
  | AsyncIterable<typesModule.AssistantMessageEvent>;

const lazyStream: {
  (
    setup: StreamSetup,
  ): (model: typesModule.Model<typesModule.Api>) => eventStreamTypes.AssistantMessageEventStream;
  (
    model: typesModule.Model<typesModule.Api>,
    setup: StreamSetup,
  ): eventStreamTypes.AssistantMessageEventStream;
} = Function.dual(
  2,
  (
    model: typesModule.Model<typesModule.Api>,
    setup: StreamSetup,
  ): eventStreamTypes.AssistantMessageEventStream => {
    const outer = new AssistantMessageEventStream();
    Effect.runFork(
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() => Promise.resolve(setup())).pipe(
          Effect.flatMap((inner) => forwardStream(outer, inner)),
          Effect.catchDefect((error) =>
            Effect.sync(() => {
              const message = createSetupErrorMessage(model, error, startedAt);
              outer.push({ error: message, reason: "error", type: "error" });
              outer.end(message);
            }),
          ),
        );
      }),
    );
    return outer;
  },
);

const loadThen = <A>(
  load: () => Promise<typesModule.ProviderStreams>,
  use: (implementation: typesModule.ProviderStreams) => A | Promise<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.promise(() => load()).pipe(
      Effect.flatMap((implementation) =>
        Effect.promise(() => Promise.resolve(use(implementation))),
      ),
    ),
  );

const withDeferredSupport = (
  api: typesModule.ProviderStreams,
  load: () => Promise<typesModule.ProviderStreams>,
  capabilities: lazyTypes.LazyApiCapabilities | undefined,
): typesModule.ProviderStreams => {
  if (capabilities?.fetchDeferred === true) {
    api.fetchDeferred = (model, handle, options) =>
      lazyStream(model, () =>
        loadThen(load, (implementation) => {
          if (implementation.fetchDeferred === undefined)
            throw new Error("API does not support deferred responses");
          return implementation.fetchDeferred(model, handle, options);
        }),
      );
  }
  if (capabilities?.cancelDeferred === true) {
    api.cancelDeferred = (model, handle, options) =>
      loadThen(load, (implementation) => {
        if (implementation.cancelDeferred === undefined)
          throw new Error("API cannot cancel deferred responses");
        return implementation.cancelDeferred(model, handle, options);
      });
  }
  if (capabilities?.countTokens === true) {
    api.countTokens = (model, context, options) =>
      loadThen(load, (implementation) => {
        if (implementation.countTokens === undefined) throw new Error("API cannot count tokens");
        return implementation.countTokens(model, context, options);
      });
  }
  return api;
};

const lazyApi: {
  (
    capabilities?: lazyTypes.LazyApiCapabilities,
  ): (load: () => Promise<typesModule.ProviderStreams>) => typesModule.ProviderStreams;
  (
    load: () => Promise<typesModule.ProviderStreams>,
    capabilities?: lazyTypes.LazyApiCapabilities,
  ): typesModule.ProviderStreams;
} = Function.dual(
  (args) => typeof args[0] === "function",
  (
    load: () => Promise<typesModule.ProviderStreams>,
    capabilities?: lazyTypes.LazyApiCapabilities,
  ): typesModule.ProviderStreams =>
    withDeferredSupport(
      {
        stream: (model, context, options) =>
          lazyStream(model, () =>
            loadThen(load, (implementation) => implementation.stream(model, context, options)),
          ),
        streamSimple: (model, context, options) =>
          lazyStream(model, () =>
            loadThen(load, (implementation) =>
              implementation.streamSimple(model, context, options),
            ),
          ),
      },
      load,
      capabilities,
    ),
);

const lazy = {
  lazyApi,
  lazyStream,
};

export default lazy;
