import { Effect, Schema, Stream } from "effect";
import { afterEach, beforeEach, vi } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type compatTypes from "../src/compat.types.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import env from "./env.ts";

const { normalizeContext } = compatModule;
const { currentTimeMillis } = clock;

const { envValue } = env;

class PayloadCaptured extends Schema.TaggedError<
  PayloadCaptured,
  { readonly brand: unique symbol }
>()("PayloadCaptured", { message: Schema.String }) {}

const toCaptured = (error: unknown): PayloadCaptured =>
  Schema.is(PayloadCaptured)(error) ? error : PayloadCaptured.make({ message: String(error) });

const context = normalizeContext({
  messages: [{ content: "Hello", role: "user", timestamp: currentTimeMillis() }],
  systemPrompt: "You are a helpful assistant.",
});

const capturePayload = <TPayload>(
  start: (onPayload: (payload: unknown) => never) => compatTypes.AssistantMessageEventStream,
): Effect.Effect<TPayload | undefined> =>
  Effect.gen(function* () {
    const captured: { value: TPayload | undefined } = { value: undefined };
    const stream = start((payload) => {
      captured.value = payload as TPayload;
      throw PayloadCaptured.make({ message: "payload captured" });
    });
    yield* Effect.ignore(
      Stream.fromAsyncIterable(stream, toCaptured).pipe(
        Stream.runForEachWhile((event) => Effect.succeed(event.type !== "error")),
      ),
    );
    return captured.value;
  });

const isolateCacheRetentionEnv = (): void => {
  const originalEnv = envValue("MSA_CACHE_RETENTION");
  beforeEach(() => {
    vi.stubEnv("MSA_CACHE_RETENTION", undefined);
  });
  afterEach(() => {
    vi.stubEnv("MSA_CACHE_RETENTION", originalEnv);
  });
};

const createCompletionsModel = (
  compat?: typesModule.Model<"openai-completions">["compat"],
): typesModule.Model<"openai-completions"> => ({
  api: "openai-completions",
  baseUrl: "https://my-proxy.example.com/v1",
  compat,
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-model",
  input: ["text"],
  maxTokens: 4096,
  name: "Test Model",
  provider: "test-openai-completions",
  reasoning: false,
});

const cacheRetentionSupport = {
  capturePayload,
  context,
  createCompletionsModel,
  isolateCacheRetentionEnv,
};

export default cacheRetentionSupport;
