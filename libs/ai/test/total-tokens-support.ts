import { Clock, Console, Effect } from "effect";
import { expect } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";

const { complete } = compat;

type StreamOptionsWithExtras = typesModule.StreamOptions & Record<string, unknown>;

const LONG_SYSTEM_PROMPT = `You are a helpful assistant. Be concise in your responses.

Here is some additional context that makes this system prompt long enough to trigger caching:

${Array(50)
  .fill(
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
  )
  .join("\n\n")}

Remember: Always be helpful and concise.`;

const testTotalTokensWithCache = Effect.fn("testTotalTokensWithCache")(function* <
  TApi extends typesModule.Api,
>(llm: typesModule.Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const context1: typesModule.Context = {
    messages: [
      {
        content: "What is 2 + 2? Reply with just the number.",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: LONG_SYSTEM_PROMPT,
  };

  const response1 = yield* Effect.promise(() => complete(llm, context1, options));
  expect(response1.stopReason).toBe("stop");

  const context2: typesModule.Context = {
    messages: [
      ...context1.messages,
      response1,
      {
        content: "What is 3 + 3? Reply with just the number.",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: LONG_SYSTEM_PROMPT,
  };

  const response2 = yield* Effect.promise(() => complete(llm, context2, options));
  expect(response2.stopReason).toBe("stop");

  return { first: response1.usage, second: response2.usage };
});

const computedTotal = (usage: typesModule.Usage) =>
  usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

const logUsage = (label: string, usage: typesModule.Usage) =>
  Console.log(
    `  ${label}: input: ${usage.input}, output: ${usage.output}, cacheRead: ${usage.cacheRead}, cacheWrite: ${usage.cacheWrite}, totalTokens: ${usage.totalTokens}, computed: ${computedTotal(usage)}`,
  );

const expectTotalTokens = Effect.fn("expectTotalTokens")(function* <TApi extends typesModule.Api>(
  label: string,
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  yield* Console.log(`\n${label} / ${llm.id}:`);
  const { first, second } = yield* testTotalTokensWithCache(llm, options);
  yield* logUsage("First request", first);
  yield* logUsage("Second request", second);
  expect(first.totalTokens).toBe(computedTotal(first));
  expect(second.totalTokens).toBe(computedTotal(second));
  return { first, second };
});

const totalTokensSupport = { expectTotalTokens };

export default totalTokensSupport;
