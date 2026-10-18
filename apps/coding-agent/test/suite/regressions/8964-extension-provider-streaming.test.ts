import { type AssistantMessage, fauxAssistantMessage, fauxProvider } from "@msa/ai";
import { getApiProvider } from "@msa/ai/compat";
import { currentTimeMillis } from "@msa/testing";
import { Effect, Stream } from "effect";
import { expect, it } from "vite-plus/test";

import { createHarness } from "../harness.ts";

it.each(["stream", "streamSimple"] as const)(
  "allows an extension command to use ctx.modelRegistry.%s",
  (method) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
        const faux = fauxProvider({
          provider: "extension-provider",
          api: "issue-8964-extension-api",
        });
        let receivedApiKey: string | undefined;
        faux.setResponses([
          (_context, options) => {
            receivedApiKey = options?.apiKey;
            return fauxAssistantMessage("custom provider response");
          },
        ]);
        let streamedText = "";
        let result: AssistantMessage | undefined;
        const harness = yield* Effect.promise(() =>
          createHarness({
            extensionFactories: [
              (msa) => {
                msa.registerProvider(faux.provider.id, {
                  api: faux.api,
                  baseUrl: faux.getModel().baseUrl,
                  apiKey: "extension-key",
                  models: faux.models,
                  streamSimple: faux.provider.streamSimple,
                });
              },
              (msa) => {
                msa.registerCommand("stream-custom", {
                  description: "Stream a response from the custom provider",
                  handler: (_args, ctx) =>
                    runPromise(
                      Effect.gen(function* () {
                        const model = ctx.modelRegistry.find(faux.provider.id, faux.getModel().id)!;
                        const stream = ctx.modelRegistry[method](model, {
                          messages: [
                            { role: "user", content: "Hello", timestamp: currentTimeMillis() },
                          ],
                        });
                        yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
                          Stream.orDie,
                          Stream.runForEach((event) =>
                            Effect.sync(() => {
                              if (event.type === "text_delta") streamedText += event.delta;
                            }),
                          ),
                        );
                        result = yield* Effect.promise(() => stream.result());
                      }),
                    ),
                });
              },
            ],
          }),
        );
        try {
          expect(getApiProvider(faux.api)).toBeUndefined();
          yield* Effect.promise(() => harness.session.prompt("/stream-custom"));

          expect(receivedApiKey).toBe("extension-key");
          expect(streamedText).toBe("custom provider response");
          expect(result).toMatchObject({
            stopReason: "stop",
            content: [{ type: "text", text: "custom provider response" }],
          });
          expect(getApiProvider(faux.api)).toBeUndefined();
        } finally {
          harness.cleanup();
        }
      }),
    ),
);
