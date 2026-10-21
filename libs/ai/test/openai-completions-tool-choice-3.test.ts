import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiCompletionsToolChoiceSupport from "./openai-completions-tool-choice-support.ts";

vi.mock("openai", () =>
  import("./openai-completions-tool-choice-mock.ts").then((module) => module.default),
);

const { directCompletionsModel, mockState, promptModel, resetMockStateBeforeEach } =
  openaiCompletionsToolChoiceSupport;

const acceptsMissingFinishReason = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunks = [
        {
          choices: [{ delta: { content: "complete answer" }, finish_reason: null }],
          id: "chatcmpl-no-finish-reason",
        },
      ];
      const model = directCompletionsModel({ supportsFinishReason: false });
      const { response } = yield* promptModel(model, "Reply with a complete answer");
      expect(response.stopReason).toBe("stop");
      expect(response.errorMessage).toBeUndefined();
      expect(response.content).toEqual([{ text: "complete answer", type: "text" }]);
    }),
  );

const ignoresEmptyCustomObjects = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunks = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    custom: {},
                    function: { arguments: '{"path":"README.md"}', name: "read" },
                    id: "call_1",
                    index: 0,
                    type: "function",
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          id: "chatcmpl-empty-custom",
        },
      ];
      const readTool = {
        description: "Read a file",
        name: "read",
        parameters: Type.Object({ path: Type.String() }),
      };
      const { response } = yield* promptModel(directCompletionsModel(), "Read README.md", {
        tools: [readTool],
      });
      expect(response.content).toEqual([
        { arguments: { path: "README.md" }, id: "call_1", name: "read", type: "toolCall" },
      ]);
    }),
  );

describe("openai-completions tool_choice", () => {
  resetMockStateBeforeEach();

  it("accepts streams without finish_reason when compat disables it", acceptsMissingFinishReason);
  it("ignores empty custom objects on function tool call deltas", ignoresEmptyCustomObjects);
});
