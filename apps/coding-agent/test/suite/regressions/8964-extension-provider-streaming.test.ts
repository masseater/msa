import ai from "@msa/ai";
import compat from "@msa/ai/compat";
import type aiTypes from "@msa/ai/index.types";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import testing from "@msa/testing";
import { Effect, Stream } from "effect";
import { expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";

const { fauxAssistantMessage, fauxProvider } = ai;
const { getApiProvider } = compat;

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

type Faux = ReturnType<typeof fauxProvider>;
type Observed = {
  receivedApiKey?: string | undefined;
  result?: aiTypes.AssistantMessage;
  streamedText: string;
};

const registerFaux =
  (faux: Faux): codingAgentTypes.ExtensionFactory =>
  (msa) => {
    msa.registerProvider(faux.provider.id, {
      api: faux.api,
      apiKey: "extension-key",
      baseUrl: faux.getModel().baseUrl,
      models: faux.models,
      streamSimple: faux.provider.streamSimple,
    });
  };

const streamCustomCommand =
  (
    faux: Faux,
    method: "stream" | "streamSimple",
    observed: Observed,
  ): codingAgentTypes.ExtensionFactory =>
  (msa) => {
    msa.registerCommand("stream-custom", {
      description: "Stream a response from the custom provider",
      handler: (_args, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = ctx.modelRegistry.find(faux.provider.id, faux.getModel().id)!;
            const stream = ctx.modelRegistry[method](model, {
              messages: [{ content: "Hello", role: "user", timestamp: currentTimeMillis() }],
            });
            yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
              Stream.orDie,
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  if (event.type === "text_delta") observed.streamedText += event.delta;
                }),
              ),
            );
            observed.result = yield* Effect.promise(() => stream.result());
          }),
        ),
    });
  };

const streamsThroughModelRegistry = (method: "stream" | "streamSimple") =>
  Effect.gen(function* () {
    const faux = fauxProvider({ api: "issue-8964-extension-api", provider: "extension-provider" });
    const observed: Observed = { streamedText: "" };
    faux.setResponses([
      (_context, options) => {
        observed.receivedApiKey = options?.apiKey;
        return fauxAssistantMessage("custom provider response");
      },
    ]);
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [registerFaux(faux), streamCustomCommand(faux, method, observed)],
      }),
    );
    try {
      expect(getApiProvider(faux.api)).toBeUndefined();
      yield* Effect.promise(() => harness.session.prompt("/stream-custom"));

      expect(observed.receivedApiKey).toBe("extension-key");
      expect(observed.streamedText).toBe("custom provider response");
      expect(observed.result).toMatchObject({
        content: [{ text: "custom provider response", type: "text" }],
        stopReason: "stop",
      });
      expect(getApiProvider(faux.api)).toBeUndefined();
    } finally {
      harness.cleanup();
    }
  });

it.each(["stream", "streamSimple"] as const)(
  "allows an extension command to use ctx.modelRegistry.%s",
  (method) => Effect.runPromise(streamsThroughModelRegistry(method)),
);
