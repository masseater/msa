import { arch, platform, release } from "node:os";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import { OPENAI_MODELS } from "../src/providers/openai.models.ts";
import type { Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const MSA_USER_AGENT = `pi (${platform()} ${release()}; ${arch()})`;

const customCompletionsModel: Model<"openai-completions"> = {
  id: "custom-model",
  name: "Custom Model",
  api: "openai-completions",
  provider: "custom",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
};

function completedResponse(): Response {
  const event = {
    type: "response.completed",
    sequence_number: 0,
    response: {
      id: "resp_test",
      status: "completed",
      output: [],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
      },
    },
  };
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function captureResponsesUserAgent(headers?: Record<string, string>): Promise<string | null> {
  let userAgent: string | null = null;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    userAgent = new Request(input, init).headers.get("user-agent");
    return Promise.resolve(completedResponse());
  });

  const result = await streamOpenAIResponses(
    OPENAI_MODELS["gpt-5.5"],
    normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 1 }] }),
    { apiKey: "test-token", headers },
  ).result();

  expect(result.stopReason, result.errorMessage).toBe("stop");
  return userAgent;
}

async function captureCompletionsUserAgent(
  headers?: Record<string, string>,
): Promise<string | null> {
  let userAgent: string | null = null;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    userAgent = new Request(input, init).headers.get("user-agent");
    const chunks = [
      { id: "chatcmpl-ua", choices: [{ delta: { content: "ok" }, finish_reason: null, index: 0 }] },
      {
        id: "chatcmpl-ua",
        choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      },
    ];
    const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  });

  const result = await streamOpenAICompletions(
    customCompletionsModel,
    normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 1 }] }),
    { apiKey: "test-token", headers },
  ).result();

  expect(result.stopReason, result.errorMessage).toBe("stop");
  return userAgent;
}

describe("OpenAI-compatible User-Agent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses msa's User-Agent by default for Responses requests", async () => {
    expect(await captureResponsesUserAgent()).toBe(MSA_USER_AGENT);
  });

  it("lets explicit headers override the default Responses User-Agent", async () => {
    expect(await captureResponsesUserAgent({ "User-Agent": "custom-agent" })).toBe("custom-agent");
  });

  it("uses msa's User-Agent by default for Completions requests", async () => {
    expect(await captureCompletionsUserAgent()).toBe(MSA_USER_AGENT);
  });

  it("lets explicit headers override the default Completions User-Agent", async () => {
    expect(await captureCompletionsUserAgent({ "User-Agent": "custom-agent" })).toBe(
      "custom-agent",
    );
  });
});
