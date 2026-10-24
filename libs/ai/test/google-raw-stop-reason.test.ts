import { arch, platform } from "node:os";

import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@google/genai", () => import("./google-genai-mock.ts").then((module) => module.default));

import googleGenerativeAi from "../src/api/google-generative-ai.ts";
import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import googleGenAiMockModule from "./google-genai-mock.ts";
import modelChoice from "./model-choice.ts";

const { normalizeContext } = compat;
const { currentTimeMillis } = clock;
const { stream: streamGoogleGenerativeAi } = googleGenerativeAi;

const { chooseModel, usesApi } = modelChoice;

const { googleGenAiMock } = googleGenAiMockModule;

beforeEach(() => {
  googleGenAiMock.streamChunks = undefined;
  googleGenAiMock.streamError = undefined;
});

const MSA_USER_AGENT = `pi (${platform()}; ${arch()})`;

const context = normalizeContext({
  messages: [{ content: "hello", role: "user", timestamp: currentTimeMillis() }],
});

const googleGenerativeModel = () =>
  chooseModel("opencode", "Google Generative AI", usesApi("google-generative-ai"));

const captureGoogleHeaders = Effect.fn("captureGoogleHeaders")(function* (
  headers?: Record<string, string>,
) {
  googleGenAiMock.constructorCalls.length = 0;
  googleGenAiMock.finishReason = "STOP";
  googleGenAiMock.includeFunctionCall = false;
  yield* Effect.promise(() =>
    streamGoogleGenerativeAi(googleGenerativeModel(), context, {
      apiKey: "test-api-key",
      headers,
    }).result(),
  );

  expect(googleGenAiMock.constructorCalls).toHaveLength(1);
  const httpOptions = googleGenAiMock.constructorCalls[0]?.["httpOptions"] as {
    headers?: Record<string, string>;
  };
  return httpOptions.headers ?? {};
});

const preservesRawGeminiFinishReasonsFor = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      googleGenAiMock.finishReason = "MALFORMED_FUNCTION_CALL";
      googleGenAiMock.includeFunctionCall = false;

      const stream = streamGoogleGenerativeAi(googleGenerativeModel(), context, {
        apiKey: "test-api-key",
      });

      const message = yield* Effect.promise(() => stream.result());

      expect(message.stopReason).toBe("error");
      expect(message.rawStopReason).toBe("MALFORMED_FUNCTION_CALL");
      expect(message.errorMessage).toBe("Provider stopped with: MALFORMED_FUNCTION_CALL");
    }),
  );

describe("Google raw stop reasons", () => {
  it(
    "preserves raw Gemini finish reasons for Google Generative AI errors",
    preservesRawGeminiFinishReasonsFor,
  );
});

describe("Google raw stop reasons", () => {
  const adapters = [
    {
      createStream: () =>
        streamGoogleGenerativeAi(googleGenerativeModel(), context, {
          apiKey: "test-api-key",
        }),
      name: "Google Generative AI",
    },
  ];
  it.each(adapters)(
    "preserves MAX_TOKENS with a tool call as length for $name",
    ({ createStream }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          googleGenAiMock.finishReason = "MAX_TOKENS";
          googleGenAiMock.includeFunctionCall = true;

          const message = yield* Effect.promise(() => createStream().result());

          expect(message.stopReason).toBe("length");
          expect(message.rawStopReason).toBe("MAX_TOKENS");
          expect(message.content.some((block) => block.type === "toolCall")).toBe(true);
        }),
      ),
  );

  it.each(adapters)("maps STOP with a tool call to toolUse for $name", ({ createStream }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        googleGenAiMock.finishReason = "STOP";
        googleGenAiMock.includeFunctionCall = true;

        const message = yield* Effect.promise(() => createStream().result());

        expect(message.stopReason).toBe("toolUse");
        expect(message.rawStopReason).toBe("STOP");
        expect(message.content.some((block) => block.type === "toolCall")).toBe(true);
      }),
    ),
  );
});

describe("Google request failures", () => {
  it("record the HTTP status of the failed request", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        googleGenAiMock.streamError = Object.assign(new Error("quota gone"), { status: 429 });
        const message = yield* Effect.promise(() =>
          streamGoogleGenerativeAi(googleGenerativeModel(), context, {
            apiKey: "test-api-key",
            maxRetries: 0,
          }).result(),
        );
        expect(message.stopReason).toBe("error");
        expect(message.errorStatus).toBe(429);
      }),
    ));
});

describe("Google provider stream events", () => {
  const adapters = stepStep22();

  it.each(adapters)(
    "forwards each SDK chunk in order before normalizing it for $name",
    ({ model, createStream }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const effectContext = yield* Effect.context();
          googleGenAiMock.streamChunks = [
            {
              candidates: [{ content: { parts: [{ text: "hello" }] } }],
              responseId: "resp_google",
            },
            {
              candidates: [{ finishReason: "STOP" }],
              usageMetadata: { candidatesTokenCount: 1, promptTokenCount: 2, totalTokenCount: 3 },
            },
          ];
          const received: unknown[] = [];
          const eventModels: typesModule.Model<typesModule.Api>[] = [];
          const result = yield* Effect.promise(() =>
            createStream((chunk, eventModel) =>
              Effect.runPromiseWith(effectContext)(
                Effect.gen(function* () {
                  yield* Effect.promise(() => Promise.resolve());
                  received.push(chunk);
                  eventModels.push(eventModel);
                }),
              ),
            ).result(),
          );

          expect(received).toEqual(googleGenAiMock.streamChunks);
          expect(received[0]).toBe(googleGenAiMock.streamChunks[0]);
          expect(received[1]).toBe(googleGenAiMock.streamChunks[1]);
          expect(eventModels).toEqual([model, model]);
          expect(result.stopReason).toBe("stop");
          expect(result.responseId).toBe("resp_google");
          expect(result.content).toEqual([{ text: "hello", type: "text" }]);
        }),
      ),
  );
});

const usesMsaSUserAgentBy = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect((yield* captureGoogleHeaders())["User-Agent"]).toBe(MSA_USER_AGENT);
    }),
  );

const letsExplicitHeadersOverrideTheDefault = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect((yield* captureGoogleHeaders({ "User-Agent": "custom-agent" }))["User-Agent"]).toBe(
        "custom-agent",
      );
    }),
  );

describe("Google Generative AI user agent", () => {
  it("uses msa's User-Agent by default", usesMsaSUserAgentBy);

  it(
    "lets explicit headers override the default User-Agent",
    letsExplicitHeadersOverrideTheDefault,
  );
});

function stepStep22() {
  const googleModel = googleGenerativeModel();
  const adapters = [
    {
      createStream: (onProviderStreamEvent: typesModule.StreamOptions["onProviderStreamEvent"]) =>
        streamGoogleGenerativeAi(googleModel, context, {
          apiKey: "test-api-key",
          onProviderStreamEvent,
        }),
      model: googleModel,
      name: "Google Generative AI",
    },
  ];
  return adapters;
}
