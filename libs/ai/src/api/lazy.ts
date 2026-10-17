import { Clock, Effect, Function, Stream } from "effect";

import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  ProviderStreams,
} from "../types.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";

const createSetupErrorMessage = (
  model: Model<Api>,
  error: unknown,
  timestamp: number,
): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "error",
  errorMessage: toErrorMessage(error),
  timestamp,
});

const hasResult = (
  source: AsyncIterable<AssistantMessageEvent>,
): source is AsyncIterable<AssistantMessageEvent> & { result(): Promise<AssistantMessage> } =>
  typeof (source as { result?: unknown }).result === "function";

const forwardStream = (
  target: AssistantMessageEventStream,
  source: AsyncIterable<AssistantMessageEvent>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Stream.fromAsyncIterable(source, (error) => error).pipe(
      Stream.orDie,
      Stream.runForEach((event) => Effect.sync(() => target.push(event))),
    );
    target.end(hasResult(source) ? yield* Effect.promise(() => source.result()) : undefined);
  });

type StreamSetup = () =>
  | Promise<AsyncIterable<AssistantMessageEvent>>
  | AsyncIterable<AssistantMessageEvent>;

export const lazyStream: {
  (setup: StreamSetup): (model: Model<Api>) => AssistantMessageEventStream;
  (model: Model<Api>, setup: StreamSetup): AssistantMessageEventStream;
} = Function.dual(2, (model: Model<Api>, setup: StreamSetup): AssistantMessageEventStream => {
  const outer = new AssistantMessageEventStream();
  Effect.runFork(
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() => Promise.resolve(setup())).pipe(
        Effect.flatMap((inner) => forwardStream(outer, inner)),
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            const message = createSetupErrorMessage(model, error, startedAt);
            outer.push({ type: "error", reason: "error", error: message });
            outer.end(message);
          }),
        ),
      );
    }),
  );
  return outer;
});

export interface LazyApiCapabilities {
  fetchDeferred?: boolean;
  cancelDeferred?: boolean;
}

const loadThen = <A>(
  load: () => Promise<ProviderStreams>,
  use: (implementation: ProviderStreams) => A | Promise<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.promise(() => load()).pipe(
      Effect.flatMap((implementation) =>
        Effect.promise(() => Promise.resolve(use(implementation))),
      ),
    ),
  );

const withDeferredSupport = (
  api: ProviderStreams,
  load: () => Promise<ProviderStreams>,
  capabilities: LazyApiCapabilities | undefined,
): ProviderStreams => {
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
  return api;
};

export const lazyApi: {
  (capabilities?: LazyApiCapabilities): (load: () => Promise<ProviderStreams>) => ProviderStreams;
  (load: () => Promise<ProviderStreams>, capabilities?: LazyApiCapabilities): ProviderStreams;
} = Function.dual(
  (args) => typeof args[0] === "function",
  (load: () => Promise<ProviderStreams>, capabilities?: LazyApiCapabilities): ProviderStreams =>
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
