import { Clock, Effect } from "effect";
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses.js";
import { Type } from "typebox";
import { describe, expect, inject, it } from "vite-plus/test";

import type { Api, Context, Model, StreamOptions, Tool } from "../src/compat.ts";
import { complete } from "../src/compat.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";
import redCircle from "./red-circle.ts";

const { hasEnv, hasValue } = env;
const { chooseModel, usesApi } = modelChoice;

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;
type ResponseInputItem = { readonly role?: unknown; readonly type?: unknown } | null;
type FunctionCallOutputItem = {
  readonly output: string | ResponseFunctionCallOutputItemList;
  readonly type: "function_call_output";
};

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];
const toolText = "A red circle with a diameter of 100 pixels.";

const getImageSchema = Type.Object({});
const getImageTool: Tool<typeof getImageSchema> = {
  description: "Returns a red circle image with a short text description.",
  name: "get_circle_with_description",
  parameters: getImageSchema,
};

const answerWithToolImage = Effect.fn("answerWithToolImage")(function* <TApi extends Api>(
  model: Model<TApi>,
  options: StreamOptionsWithExtras,
) {
  const context: Context = {
    messages: [
      {
        content:
          "Call get_circle_with_description, then describe both the tool text and the image. Mention the color and shape.",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: "You are a helpful assistant that always uses the provided tool when asked.",
    tools: [getImageTool],
  };
  const firstResponse = yield* Effect.promise(() => complete(model, context, options));
  expect(firstResponse.stopReason, `Error: ${firstResponse.errorMessage}`).toBe("toolUse");
  const toolCall = firstResponse.content.find((block) => block.type === "toolCall");
  if (toolCall?.type !== "toolCall") throw new Error("Expected tool call");
  context.messages.push(firstResponse, {
    content: [
      { text: toolText, type: "text" },
      { data: redCircle.data, mimeType: redCircle.mimeType, type: "image" },
    ],
    isError: false,
    role: "toolResult",
    timestamp: yield* Clock.currentTimeMillis,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  });
  const captured: { payload?: unknown } = {};
  const response = yield* Effect.promise(() =>
    complete(model, context, {
      ...options,
      onPayload: (payload) => {
        captured.payload = payload;
      },
    }),
  );
  return { payload: captured.payload, response };
});

const responseInputOf = (payload: unknown): ResponseInputItem[] => {
  const input = (payload as { input?: unknown } | undefined)?.input;
  if (!Array.isArray(input)) throw new TypeError("Expected payload with input array");
  return input as ResponseInputItem[];
};

const expectImageInFunctionCallOutput = (input: ResponseInputItem[]) => {
  const outputIndex = input.findIndex((item) => item?.type === "function_call_output");
  const functionCallOutput = input[outputIndex] as FunctionCallOutputItem | undefined;
  if (!Array.isArray(functionCallOutput?.output)) {
    throw new TypeError("Expected function_call_output output to be a content array");
  }
  const items = functionCallOutput.output;
  const textItem = items.find((item) => item.type === "input_text");
  const imageItem = items.find((item) => item.type === "input_image");
  expect(textItem?.type === "input_text" ? textItem.text : undefined).toContain(toolText);
  expect(imageItem?.type === "input_image" ? imageItem.image_url : undefined).toMatch(
    /^data:image\/png;base64,/u,
  );
  expect(input.slice(outputIndex + 1).filter((item) => item?.role === "user")).toHaveLength(0);
};

const sendsToolResultImages =
  <TApi extends Api>(model: Model<TApi>, options: StreamOptionsWithExtras) =>
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { payload, response } = yield* answerWithToolImage(model, options);
        expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
        expect(response.errorMessage).toBeFalsy();
        expectImageInFunctionCallOutput(responseInputOf(payload));
        const responseText = response.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join(" ")
          .toLowerCase();
        expect(responseText).toContain("red");
        expect(responseText).toContain("circle");
      }),
    );

const openaiModel = chooseModel(
  "openai",
  "image-capable Responses reasoning",
  (model): model is Model<"openai-responses"> =>
    usesApi("openai-responses")(model) && model.input.includes("image") && model.reasoning,
);
const codexModel = chooseModel("openai-codex", "image-capable", (model) =>
  model.input.includes("image"),
);

describe("Responses API tool result images", () => {
  it.skipIf(!hasEnv("OPENAI_API_KEY"))(
    "OpenAI Responses sends tool result images in function_call_output",
    { retry: 3, timeout: 30000 },
    sendsToolResultImages(openaiModel, { reasoningEffort: "low" }),
  );
  it.skipIf(!hasValue(openaiCodexToken))(
    "OpenAI Codex Responses sends tool result images in function_call_output",
    { retry: 3, timeout: 30000 },
    sendsToolResultImages(codexModel, { apiKey: openaiCodexToken, reasoningEffort: "low" }),
  );
});
