import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import anthropicSseParsingSupport from "./anthropic-sse-parsing-support.ts";
import modelChoice from "./model-choice.ts";

const { normalizeContext } = compat;
const { currentTimeMillis } = clock;
const { stream: streamAnthropic } = anthropicMessages;

const { createFakeAnthropicClient, createSseResponse, sse } = anthropicSseParsingSupport;
const { chooseModel, usesApi } = modelChoice;

const malformedToolJsonDelta = String.raw`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"A\H\",\"text\":\"col1	col2\"}"}}`;

const malformedToolCallResponse = () =>
  createSseResponse([
    sse.messageStart("msg_test"),
    sse.blockStart(0, { id: "toolu_test", input: {}, name: "edit", type: "tool_use" }),
    { data: malformedToolJsonDelta, event: "content_block_delta" },
    sse.blockStop(0),
    sse.messageDelta({ stop_reason: "tool_use" }),
    sse.messageStop,
  ]);

const editContext = () =>
  normalizeContext({
    messages: [{ content: "Use the edit tool.", role: "user", timestamp: currentTimeMillis() }],
    tools: [
      {
        description: "Edit a file.",
        name: "edit",
        parameters: Type.Object({ path: Type.String(), text: Type.String() }),
      },
    ],
  });

const repairsMalformedJson = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));
      const stream = streamAnthropic(model, editContext(), {
        client: createFakeAnthropicClient(malformedToolCallResponse()),
      });
      const result = yield* Effect.promise(() => stream.result());

      expect(result.stopReason).toBe("toolUse");
      expect(result.errorMessage).toBeUndefined();
      const toolCall = result.content.find(
        (block): block is typesModule.ToolCall => block.type === "toolCall",
      );
      expect(toolCall?.arguments).toEqual({ path: "A\\H", text: "col1\tcol2" });
    }),
  );

describe("Anthropic raw SSE parsing", () => {
  it("repairs malformed SSE JSON and malformed streamed tool JSON", repairsMalformedJson);
});
