import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import env from "./env.ts";
import toolCallIdNormalizationSupport from "./tool-call-id-normalization-support.ts";

const { currentTimeMillis } = clock;

const { hasValue } = env;
const {
  codexModel,
  codexToken,
  hasOpenRouter,
  openaiModel,
  openrouterKey,
  openrouterModel,
  replyAfterToolResult,
} = toolCallIdNormalizationSupport;

const FAILING_TOOL_CALL_ID =
  "call_pAYbIr76hXIjncD9UE4eGfnS|t5nnb2qYMFWGSsr13fhCd1CaCu3t3qONEPuOudu4HSVEtA8YJSL6FAZUxvoOoD792VIJWl91g87EdqsCWp9krVsdBysQoDaf9lMCLb8BS4EYi4gQd5kBQBYLlgD71PYwvf+TbMD9J9/5OMD42oxSRj8H+vRf78/l2Xla33LWz4nOgsddBlbvabICRs8GHt5C9PK5keFtzyi3lsyVKNlfduK3iphsZqs4MLv4zyGJnvZo/+QzShyk5xnMSQX/f98+aEoNflEApCdEOXipipgeiNWnpFSHbcwmMkZoJhURNu+JEz3xCh1mrXeYoN5o+trLL3IXJacSsLYXDrYTipZZbJFRPAucgbnjYBC+/ZzJOfkwCs+Gkw7EoZR7ZQgJ8ma+9586n4tT4cI8DEhBSZsWMjrCt8dxKg==";

const buildPrefilledMessages = (): typesModule.Message[] => [
  {
    content: "Use the echo tool to echo 'hello'",
    role: "user",
    timestamp: currentTimeMillis() - 2000,
  },
  {
    api: openaiModel.api,
    content: [
      { arguments: { message: "hello" }, id: FAILING_TOOL_CALL_ID, name: "echo", type: "toolCall" },
    ],
    model: openaiModel.id,
    provider: openaiModel.provider,
    role: "assistant",
    stopReason: "toolUse",
    timestamp: currentTimeMillis() - 1500,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 100,
      output: 50,
      totalTokens: 150,
    },
  },
  {
    content: [{ text: "hello", type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: currentTimeMillis() - 1000,
    toolCallId: FAILING_TOOL_CALL_ID,
    toolName: "echo",
  },
  { content: "Say hi", role: "user", timestamp: currentTimeMillis() },
];

const openrouterHandlesPrefilledIds = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* replyAfterToolResult(
        openrouterModel,
        openrouterKey,
        buildPrefilledMessages(),
      );
      expect(response.stopReason, `OpenRouter error: ${response.errorMessage}`).not.toBe("error");
      if (hasValue(response.errorMessage)) {
        expect(response.errorMessage).not.toContain("call_id");
        expect(response.errorMessage).not.toContain("too long");
      }
    }),
  );

const codexHandlesPrefilledIds = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* replyAfterToolResult(
        codexModel,
        codexToken,
        buildPrefilledMessages(),
      );
      expect(response.stopReason, `Codex error: ${response.errorMessage}`).not.toBe("error");
      if (hasValue(response.errorMessage)) {
        expect(response.errorMessage).not.toContain("id");
        expect(response.errorMessage).not.toContain("additional characters");
      }
    }),
  );

describe("Tool Call ID Normalization - Prefilled Context", () => {
  it.skipIf(!hasOpenRouter)(
    "openrouter should handle prefilled context with long pipe-separated IDs",
    openrouterHandlesPrefilledIds,
    30000,
  );
  it.skipIf(!hasValue(codexToken))(
    "openai-codex should handle prefilled context with long pipe-separated IDs",
    codexHandlesPrefilledIds,
    30000,
  );
});
