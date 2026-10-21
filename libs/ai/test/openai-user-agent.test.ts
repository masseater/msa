import { arch, platform } from "node:os";

import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import openaiCompletions from "../src/api/openai-completions.ts";
import openaiResponses from "../src/api/openai-responses.ts";
import type typesModule from "../src/types.types.ts";
import transcript from "../src/utils/transcript.ts";
import modelChoice from "./model-choice.ts";

const { stream: streamOpenAIResponses } = openaiResponses;
const { normalizeContext } = transcript;
const { stream: streamOpenAICompletions } = openaiCompletions;

const { chooseModel, usesApi } = modelChoice;

const MSA_USER_AGENT = `pi (${platform()}; ${arch()})`;

const customCompletionsModel: typesModule.Model<"openai-completions"> = {
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "custom-model",
  input: ["text"],
  maxTokens: 16384,
  name: "Custom Model",
  provider: "custom",
  reasoning: false,
};

function completedResponse(): Response {
  const event = {
    response: {
      id: "resp_test",
      output: [],
      status: "completed",
      usage: {
        input_tokens: 1,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 1,
        total_tokens: 2,
      },
    },
    sequence_number: 0,
    type: "response.completed",
  };
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

function captureResponsesUserAgent(headers?: Record<string, string>): Promise<string | null> {
  return Effect.runPromise(
    Effect.gen(function* () {
      let userAgent: string | null = null;
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        userAgent = new Request(input, init).headers.get("user-agent");
        return Promise.resolve(completedResponse());
      });

      const result = yield* Effect.promise(() =>
        streamOpenAIResponses(
          chooseModel("openai", "Responses", usesApi("openai-responses")),
          normalizeContext({ messages: [{ content: "hello", role: "user", timestamp: 1 }] }),
          { apiKey: "test-token", headers },
        ).result(),
      );

      expect(result.stopReason, result.errorMessage).toBe("stop");
      return userAgent;
    }),
  );
}

function captureCompletionsUserAgent(headers?: Record<string, string>): Promise<string | null> {
  return Effect.runPromise(
    Effect.gen(function* () {
      let userAgent: string | null = null;
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        userAgent = new Request(input, init).headers.get("user-agent");
        const chunks = [
          {
            choices: [{ delta: { content: "ok" }, finish_reason: null, index: 0 }],
            id: "chatcmpl-ua",
          },
          {
            choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
            id: "chatcmpl-ua",
            usage: {
              completion_tokens: 1,
              completion_tokens_details: { reasoning_tokens: 0 },
              prompt_tokens: 1,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          },
        ];
        const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
        return Promise.resolve(
          new Response(body, {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          }),
        );
      });

      const result = yield* Effect.promise(() =>
        streamOpenAICompletions(
          customCompletionsModel,
          normalizeContext({ messages: [{ content: "hello", role: "user", timestamp: 1 }] }),
          { apiKey: "test-token", headers },
        ).result(),
      );

      expect(result.stopReason, result.errorMessage).toBe("stop");
      return userAgent;
    }),
  );
}

describe("OpenAI-compatible User-Agent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses msa's User-Agent by default for Responses requests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* Effect.promise(() => captureResponsesUserAgent())).toBe(MSA_USER_AGENT);
      }),
    ));

  it("lets explicit headers override the default Responses User-Agent", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(
          yield* Effect.promise(() => captureResponsesUserAgent({ "User-Agent": "custom-agent" })),
        ).toBe("custom-agent");
      }),
    ));

  it("uses msa's User-Agent by default for Completions requests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* Effect.promise(() => captureCompletionsUserAgent())).toBe(MSA_USER_AGENT);
      }),
    ));

  it("lets explicit headers override the default Completions User-Agent", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(
          yield* Effect.promise(() =>
            captureCompletionsUserAgent({ "User-Agent": "custom-agent" }),
          ),
        ).toBe("custom-agent");
      }),
    ));
});
