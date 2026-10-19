import { Clock, Console, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions, Usage } from "../src/types.ts";
import { envValue, readEnv } from "./env.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { resolveApiKey } from "./oauth.ts";

const openaiCodexToken = await resolveApiKey("openai-codex");

const LONG_SYSTEM_PROMPT = `You are a helpful assistant. Be concise in your responses.

Here is some additional context that makes this system prompt long enough to trigger caching:

${Array(50)
  .fill(
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
  )
  .join("\n\n")}

Remember: Always be helpful and concise.`;

const testTotalTokensWithCache = Effect.fn("testTotalTokensWithCache")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context1: Context = {
    systemPrompt: LONG_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: "What is 2 + 2? Reply with just the number.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response1 = yield* Effect.promise(() => complete(llm, context1, options));
  expect(response1.stopReason).toBe("stop");

  const context2: Context = {
    systemPrompt: LONG_SYSTEM_PROMPT,
    messages: [
      ...context1.messages,
      response1,
      {
        role: "user",
        content: "What is 3 + 3? Reply with just the number.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response2 = yield* Effect.promise(() => complete(llm, context2, options));
  expect(response2.stopReason).toBe("stop");

  return { first: response1.usage, second: response2.usage };
});

function logUsage(label: string, usage: Usage) {
  const computed = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  console.log(`  ${label}:`);
  console.log(
    `    input: ${usage.input}, output: ${usage.output}, cacheRead: ${usage.cacheRead}, cacheWrite: ${usage.cacheWrite}`,
  );
  console.log(`    totalTokens: ${usage.totalTokens}, computed: ${computed}`);
}

function assertTotalTokensEqualsComponents(usage: Usage) {
  const computed = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  expect(usage.totalTokens).toBe(computed);
}

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic (API Key)", () => {
    it(
      "claude-sonnet-4-5 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("anthropic-api", "claude-sonnet-4-5");

            yield* Console.log(`\nAnthropic / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("ANTHROPIC_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);

            const hasCache = second.cacheRead > 0 || second.cacheWrite > 0 || first.cacheWrite > 0;
            expect(hasCache).toBe(true);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions",
    () => {
      it(
        "gpt-4o-mini - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
              void _compat;
              const llm: Model<"openai-completions"> = {
                ...baseModel,
                api: "openai-completions",
              };

              yield* Console.log(`\nOpenAI Completions / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm);

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses",
    () => {
      it(
        "claude-haiku-4.5 - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("openai", "gpt-4o");

              yield* Console.log(`\nOpenAI Responses / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm);

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter", () => {
    it(
      "anthropic/claude-sonnet-4.5 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "anthropic/claude-sonnet-4.5");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );

    it(
      "deepseek/deepseek-chat - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "deepseek/deepseek-chat");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });

  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter", () => {
    it(
      "mistralai/mistral-small-3.2-24b-instruct - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "mistralai/mistral-small-3.2-24b-instruct");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );

    it(
      "google/gemini-2.5-flash - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "google/gemini-2.5-flash");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });

  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter", () => {
    it(
      "deepseek/deepseek-chat - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "deepseek/deepseek-chat");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe("OpenAI Codex (OAuth)", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");

            yield* Console.log(`\nOpenAI Codex / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: openaiCodexToken,
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});
