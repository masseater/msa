import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import compactionPrompts from "../src/core/compaction/compaction-prompts.ts";
import compaction from "../src/core/compaction/index.ts";
import compactionSummaryReasoning1Support from "./compaction-summary-reasoning-1-support.ts";

const { compact, generateSummaryWithUsage } = compaction;
const { TURN_PREFIX_SUMMARIZATION_PROMPT } = compactionPrompts;

const { createModel, messages, mockSummaryResponse, mockToolCallResponse, splitTurnPreparation } =
  compactionSummaryReasoning1Support;

const { awaited, runTest, toJsonText } = testing;

const { completeSimpleMock } = vi.hoisted(() => ({
  completeSimpleMock: vi.fn(),
}));

vi.mock("@msa/ai/compat", (importOriginal) =>
  testing.runTest(
    Effect.gen(function* () {
      const actual = yield* testing.awaited(importOriginal<typeof import("@msa/ai/compat")>());
      return yield* testing.awaited({
        ...actual,
        default: { ...actual.default, completeSimple: completeSimpleMock },
      });
    }),
  ),
);

const preservesThePreviousSummaryWithoutAnEmpty = () =>
  runTest(
    Effect.gen(function* () {
      const preparation = splitTurnPreparation({ previousSummary: "previous checkpoint" });

      const result = yield* awaited(compact(preparation, createModel(false), "test-key"));

      expect(completeSimpleMock).toHaveBeenCalledTimes(1);
      expect(result.summary).toContain("previous checkpoint");
      const [call] = completeSimpleMock.mock.calls;
      if (call === undefined) throw new Error("expected completeSimple to be called");
      const requestContext = call[1] as aiTypes.TranscriptContext;
      const prompt = yield* toJsonText(requestContext.messages);

      expect(prompt).toContain("# Conversation\\n[User]: Summarize this.");
      const instructions = yield* toJsonText(`# Instructions\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`);
      expect(prompt).toContain(instructions.slice(1, -1));
    }),
  );

const lengthLimited: aiTypes.AssistantMessage = {
  ...mockSummaryResponse,
  content: [{ text: "partial", type: "text" as const }],
  stopReason: "length",
};

const rejectionCases = [
  {
    message: "Summarization attempted to call a tool",
    name: "rejects tool calls from conversation summaries",
    response: mockToolCallResponse,
    run: () => generateSummaryWithUsage(messages, createModel(false), 2000, "test-key"),
  },
  {
    message: "Turn prefix summarization attempted to call a tool",
    name: "rejects tool calls from split-turn summaries",
    response: mockToolCallResponse,
    run: () => compact(splitTurnPreparation(), createModel(false), "test-key"),
  },
  {
    message: "generation hit the token cap",
    name: "rejects a length-limited history summary",
    response: lengthLimited,
    run: () => generateSummaryWithUsage(messages, createModel(false), 2000, "test-key"),
  },
  {
    message: "generation hit the token cap",
    name: "rejects a length-limited split-turn summary",
    response: lengthLimited,
    run: () => compact(splitTurnPreparation(), createModel(false), "test-key"),
  },
];

describe("generateSummary reasoning options", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue(mockSummaryResponse);
  });

  it(
    "preserves the previous summary without an empty history request for a split turn",
    preservesThePreviousSummaryWithoutAnEmpty,
  );

  it.each(rejectionCases)("$name", ({ message, response, run }) => {
    completeSimpleMock.mockResolvedValueOnce(response);
    return runTest(awaited(expect(run()).rejects.toThrow(message)));
  });
});
