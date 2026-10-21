import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import compaction from "../src/core/compaction/index.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";

const { generateBranchSummary } = compaction;

const { createAssistantMessageEventStream, fauxAssistantMessage } = ai;

const { abortController, awaited, runTest } = testing;

const model: aiTypes.Model<"anthropic-messages"> = {
  api: "anthropic-messages",
  baseUrl: "https://api.anthropic.com",
  contextWindow: 200000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-model",
  input: ["text"],
  maxTokens: 8192,
  name: "Test Model",
  provider: "anthropic-api",
  reasoning: false,
};

const entries: sessionManagerTypes.SessionEntry[] = [
  {
    id: "branch-user",
    message: { content: "Abandoned request", role: "user", timestamp: 1 },
    parentId: null,
    timestamp: DateTime.formatIso(DateTime.makeUnsafe(1)),
    type: "message",
  },
];

function response(content: aiTypes.AssistantMessage["content"]): aiTypes.AssistantMessage {
  return {
    ...fauxAssistantMessage(""),
    api: model.api,
    content,
    model: model.id,
    provider: model.provider,
  };
}

const doesNotOverrideToolChoiceForBranch = () =>
  runTest(
    Effect.gen(function* () {
      let requestOptions: aiTypes.SimpleStreamOptions | undefined;
      const streamFn: agentTypes.StreamFn = (_model, _context, options) => {
        requestOptions = options;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() =>
          stream.push({
            message: response([{ text: "summary", type: "text" }]),
            reason: "stop",
            type: "done",
          }),
        );
        return stream;
      };

      yield* awaited(
        generateBranchSummary(entries, {
          model,
          signal: abortController().signal,
          streamFn,
        }),
      );

      expect(requestOptions?.maxTokens).toBe(4096);
      expect(requestOptions?.toolChoice).toBeUndefined();
    }),
  );

const clampsTheBranchSummaryOutputCapTo = () =>
  runTest(
    Effect.gen(function* () {
      let requestOptions: aiTypes.SimpleStreamOptions | undefined;
      const streamFn: agentTypes.StreamFn = (_model, _context, options) => {
        requestOptions = options;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() =>
          stream.push({
            message: response([{ text: "summary", type: "text" }]),
            reason: "stop",
            type: "done",
          }),
        );
        return stream;
      };

      yield* awaited(
        generateBranchSummary(entries, {
          model: { ...model, maxTokens: 1024 },
          signal: abortController().signal,
          streamFn,
        }),
      );

      expect(requestOptions?.maxTokens).toBe(1024);
    }),
  );

const rejectsToolCallsFromBranchSummaries = () =>
  runTest(
    Effect.gen(function* () {
      const streamFn: agentTypes.StreamFn = () => {
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() =>
          stream.push({
            message: response([
              {
                arguments: { path: "README.md" },
                id: "tool-call-1",
                name: "read",
                type: "toolCall",
              },
            ]),
            reason: "toolUse",
            type: "done",
          }),
        );
        return stream;
      };

      const result = yield* awaited(
        generateBranchSummary(entries, {
          model,
          signal: abortController().signal,
          streamFn,
        }),
      );

      expect(result.error).toBe("Branch summarization attempted to call a tool");
    }),
  );

const rejectsLengthLimitedBranchSummaries = () =>
  runTest(
    Effect.gen(function* () {
      const streamFn: agentTypes.StreamFn = () => {
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() =>
          stream.push({
            message: { ...response([{ text: "partial", type: "text" }]), stopReason: "length" },
            reason: "length",
            type: "done",
          }),
        );
        return stream;
      };

      const result = yield* awaited(
        generateBranchSummary(entries, {
          model,
          signal: abortController().signal,
          streamFn,
        }),
      );

      expect(result.error).toBe(
        "Branch summarization failed: generation hit the token cap and the summary is incomplete",
      );
    }),
  );

describe("branch summarization", () => {
  it("does not override tool choice for branch summaries", doesNotOverrideToolChoiceForBranch);

  it("clamps the branch summary output cap to the model limit", clampsTheBranchSummaryOutputCapTo);

  it("rejects tool calls from branch summaries", rejectsToolCallsFromBranchSummaries);

  it("rejects length-limited branch summaries", rejectsLengthLimitedBranchSummaries);
});
