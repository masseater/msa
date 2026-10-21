import { Console, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import toolCallIdNormalizationSupport from "./tool-call-id-normalization-support.ts";

const {
  codexModel,
  codexToken,
  echoThroughOpenAI,
  hasOpenAIAndCodex,
  hasOpenAIAndOpenRouter,
  openrouterKey,
  openrouterModel,
  replyAfterToolResult,
} = toolCallIdNormalizationSupport;

const openaiToOpenRouter = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { messages, toolCallId } = yield* echoThroughOpenAI("hello world");
      expect(toolCallId).toContain("|");
      yield* Console.log(`Tool call ID from openai: ${toolCallId.slice(0, 80)}...`);
      const response = yield* replyAfterToolResult(openrouterModel, openrouterKey, messages);
      expect(response.stopReason, `OpenRouter error: ${response.errorMessage}`).not.toBe("error");
      expect(response.errorMessage).toBeUndefined();
    }),
  );

const openaiToCodex = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { messages } = yield* echoThroughOpenAI("test message");
      const response = yield* replyAfterToolResult(codexModel, codexToken, messages);
      expect(response.stopReason, `Codex error: ${response.errorMessage}`).not.toBe("error");
      expect(response.errorMessage).toBeUndefined();
    }),
  );

describe("Tool Call ID Normalization - Live Handoff", () => {
  it.skipIf(!hasOpenAIAndOpenRouter)(
    "openai -> openrouter should normalize pipe-separated IDs",
    openaiToOpenRouter,
    60000,
  );
  it.skipIf(!hasOpenAIAndCodex)(
    "openai -> openai-codex should normalize pipe-separated IDs",
    openaiToCodex,
    60000,
  );
});
