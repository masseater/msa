import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import mixedDeltaChunks from "./openai-completions-mixed-deltas-fixture.ts";
import openaiCompletionsToolChoiceSupport from "./openai-completions-tool-choice-support.ts";

const { streamSimple } = compat;
const { currentTimeMillis } = clock;

vi.mock("openai", () =>
  import("./openai-completions-tool-choice-mock.ts").then((module) => module.default),
);

const {
  collectEvents,
  resetMockStateBeforeEach,
  directCompletionsModel,
  expectFinishedToolCall,
  mockState,
  readTool,
} = openaiCompletionsToolChoiceSupport;

const tools: typesModule.Tool[] = [
  readTool,
  {
    description: "Search a file",
    name: "grep",
    parameters: Type.Object({ path: Type.String(), pattern: Type.String() }),
  },
  {
    description: "List a directory",
    name: "list",
    parameters: Type.Object({ path: Type.String() }),
  },
  {
    description: "Write a file",
    name: "write",
    parameters: Type.Object({ content: Type.String(), path: Type.String() }),
  },
];

const streamMixedDeltas = () =>
  streamSimple(
    directCompletionsModel(),
    {
      messages: [
        { content: "Think, answer, and use tools.", role: "user", timestamp: currentTimeMillis() },
      ],
      tools,
    },
    { apiKey: "test" },
  );

const expectedEventCounts = {
  text_delta: 3,
  text_end: 1,
  text_start: 1,
  thinking_delta: 2,
  thinking_end: 1,
  thinking_start: 1,
  toolcall_delta: 9,
  toolcall_end: 4,
  toolcall_start: 4,
};

const toolEvents = (deltas: number) => [
  "toolcall_start",
  ...Array.from({ length: deltas }, () => "toolcall_delta"),
  "toolcall_end",
];

const expectedToolCalls = [
  { arguments: { path: "README.md" }, id: "tc_read_initial", name: "read" },
  { arguments: { path: "src", pattern: "TODO" }, id: "tc_grep_initial", name: "grep" },
  { arguments: { path: "packages/ai" }, id: "tc_list_no_index", name: "list" },
  { arguments: { content: "ok", path: "out.txt" }, id: "tc_write_no_index", name: "write" },
];

const accumulatesMixedDeltas = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunks = mixedDeltaChunks;
      const s = streamMixedDeltas();
      const { eventTypes, toolEventsByContentIndex } = yield* collectEvents(s);
      const response = yield* Effect.promise(() => s.result());

      expect(response.stopReason).toBe("toolUse");
      expect(
        Object.fromEntries(
          Object.keys(expectedEventCounts).map((type) => [
            type,
            eventTypes.filter((eventType) => eventType === type).length,
          ]),
        ),
      ).toEqual(expectedEventCounts);
      expect([2, 3, 4, 5].map((index) => toolEventsByContentIndex.get(index))).toEqual([
        toolEvents(2),
        toolEvents(3),
        toolEvents(2),
        toolEvents(2),
      ]);
      expect(response.content).toHaveLength(6);
      expect(response.content[0]).toEqual({
        thinking: "think 1 think 2",
        thinkingSignature: "reasoning_content",
        type: "thinking",
      });
      expect(response.content[1]).toEqual({ text: "answer 1 answer 2\n", type: "text" });
      expectedToolCalls.forEach((expected, offset) => {
        expectFinishedToolCall(response.content[2 + offset], expected);
      });
    }),
  );

describe("openai-completions tool_choice", () => {
  resetMockStateBeforeEach();
  it(
    "accumulates mixed content, reasoning, and parallel tool call deltas independently",
    accumulatesMixedDeltas,
  );
});
