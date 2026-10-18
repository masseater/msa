import { describe, expect, it, vi } from "vite-plus/test";

import { getModel, streamSimple } from "../src/compat.ts";

const mockState = vi.hoisted(() => ({
  lastParams: undefined as unknown,
  lastClientOptions: undefined as unknown,
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    constructor(options: unknown) {
      mockState.lastClientOptions = options;
    }

    chat = {
      completions: {
        create: (params: unknown) => {
          mockState.lastParams = params;
          const stream = {
            async *[Symbol.asyncIterator]() {
              yield {
                choices: [{ delta: {}, finish_reason: "stop" }],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  prompt_tokens_details: { cached_tokens: 0 },
                  completion_tokens_details: { reasoning_tokens: 0 },
                },
              };
            },
          };
          const promise = Promise.resolve(stream) as Promise<typeof stream> & {
            withResponse: () => Promise<{
              data: typeof stream;
              response: { status: number; headers: Headers };
            }>;
          };
          promise.withResponse = () =>
            Promise.resolve({
              data: stream,
              response: { status: 200, headers: new Headers() },
            });
          return promise;
        },
      },
    };
  }

  return { default: FakeOpenAI };
});

function openRouterModel(routing?: Record<string, unknown>) {
  const { compat: _compat, ...base } = getModel("openai", "gpt-4o-mini")!;
  return {
    ...base,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    ...(routing ? { compat: { openRouterRouting: routing } } : {}),
  } as const;
}

async function sentProvider(model: ReturnType<typeof openRouterModel>) {
  await streamSimple(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
    { apiKey: "test" },
  ).result();
  return (mockState.lastParams as { provider?: unknown }).provider;
}

describe("openrouter data_collection default", () => {
  it("denies data collection when nothing is configured", async () => {
    expect(await sentProvider(openRouterModel())).toEqual({ data_collection: "deny" });
  });

  it("keeps deny next to other routing preferences", async () => {
    expect(await sentProvider(openRouterModel({ only: ["deepinfra/fp8"] }))).toEqual({
      only: ["deepinfra/fp8"],
      data_collection: "deny",
    });
  });

  it("sends allow only when the model sets it explicitly", async () => {
    expect(await sentProvider(openRouterModel({ data_collection: "allow" }))).toEqual({
      data_collection: "allow",
    });
  });

  it("does not add provider routing to other endpoints", async () => {
    const { compat: _compat, ...base } = getModel("openai", "gpt-4o-mini")!;
    await streamSimple(
      { ...base, api: "openai-completions" } as const,
      { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
      { apiKey: "test" },
    ).result();
    expect("provider" in (mockState.lastParams as object)).toBe(false);
  });
});
