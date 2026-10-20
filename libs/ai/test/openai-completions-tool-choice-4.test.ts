import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import compat from "../src/compat.ts";
import clock from "../src/utils/clock.ts";
import openaiCompletionsToolChoiceSupport from "./openai-completions-tool-choice-support.ts";

const { streamSimple } = compat;
const { currentTimeMillis } = clock;

vi.mock("openai", () =>
  import("./openai-completions-tool-choice-mock.ts").then((module) => module.default),
);

const {
  chunkUsage,
  collectEvents,
  directCompletionsModel,
  expectFinishedToolCall,
  mockState,
  readTool,
  resetMockStateBeforeEach,
} = openaiCompletionsToolChoiceSupport;

const toolCallChunk = (
  id: string,
  call: { arguments: string; name: string | null },
  finishReason: string | null,
) => ({
  choices: [
    {
      delta: { tool_calls: [{ function: call, id, index: 0, type: "function" }] },
      finish_reason: finishReason,
    },
  ],
  id: "chatcmpl-kimi-bad-stream",
});

const mutatedIdChunks: typeof mockState.chunks = [
  toolCallChunk("functions.read:0", { arguments: "", name: "read" }, null),
  toolCallChunk("chatcmpl-tool-a", { arguments: '{"path":"README', name: null }, null),
  {
    ...toolCallChunk("chatcmpl-tool-b", { arguments: '.md"}', name: null }, "tool_calls"),
    usage: chunkUsage(10, 5),
  },
];

const coalescesMutatedIds = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunks = mutatedIdChunks;
      const s = streamSimple(
        directCompletionsModel(),
        {
          messages: [{ content: "Read README.md", role: "user", timestamp: currentTimeMillis() }],
          tools: [readTool],
        },
        { apiKey: "test" },
      );
      const { toolEventsByContentIndex } = yield* collectEvents(s);
      const response = yield* Effect.promise(() => s.result());

      expect(response.stopReason).toBe("toolUse");
      expect([...toolEventsByContentIndex.keys()]).toEqual([0]);
      expect(toolEventsByContentIndex.get(0)).toHaveLength(5);
      expect(response.content).toHaveLength(1);
      expectFinishedToolCall(response.content[0], {
        arguments: { path: "README.md" },
        id: "functions.read:0",
        name: "read",
      });
    }),
  );

describe("openai-completions tool_choice", () => {
  resetMockStateBeforeEach();

  it(
    "coalesces tool call deltas by stable index when provider mutates ids mid-stream",
    coalescesMutatedIds,
  );
});
