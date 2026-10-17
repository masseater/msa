import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Clock, Console, Effect } from "effect";
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses.js";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import type { Api, Context, Model, StreamOptions, Tool, ToolResultMessage } from "../src/compat.ts";
import { complete, getModel } from "../src/compat.ts";
import { hasAzureOpenAICredentials, resolveAzureDeploymentName } from "./azure-utils.ts";
import { envValue } from "./env.ts";
import { resolveApiKey } from "./oauth.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

const openaiCodexToken = await resolveApiKey("openai-codex");

const getImageSchema = Type.Object({});
const getImageTool: Tool<typeof getImageSchema> = {
  name: "get_circle_with_description",
  description: "Returns a red circle image with a short text description.",
  parameters: getImageSchema,
};

type CapturedResponsePayload = { input?: unknown[] };
type FunctionCallOutputItem = {
  type: "function_call_output";
  output: string | ResponseFunctionCallOutputItemList;
};
type InputTextItem = { type: "input_text"; text: string };
type InputImageItem = { type: "input_image"; image_url: string };

const verifyToolResultImagesStayInFunctionCallOutput = Effect.fn(
  "verifyToolResultImagesStayInFunctionCallOutput",
)(function* <TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
  if (!model.input.includes("image")) {
    yield* Console.log(
      `Skipping responses tool-result image test. Model ${model.id} does not support images.`,
    );
    return;
  }

  const imagePath = join(import.meta.dirname, "data", "red-circle.png");
  const base64Image = readFileSync(imagePath).toString("base64");
  const toolText = "A red circle with a diameter of 100 pixels.";

  const context: Context = {
    systemPrompt: "You are a helpful assistant that always uses the provided tool when asked.",
    messages: [
      {
        role: "user",
        content:
          "Call get_circle_with_description, then describe both the tool text and the image. Mention the color and shape.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    tools: [getImageTool],
  };

  const firstResponse = yield* Effect.promise(() => complete(model, context, options));
  expect(firstResponse.stopReason, `Error: ${firstResponse.errorMessage}`).toBe("toolUse");

  const toolCall = firstResponse.content.find((block) => block.type === "toolCall");
  expect(toolCall).toBeTruthy();
  if (toolCall === undefined || toolCall.type !== "toolCall") {
    throw new Error("Expected tool call");
  }

  context.messages.push(firstResponse);
  context.messages.push({
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [
      { type: "text", text: toolText },
      { type: "image", data: base64Image, mimeType: "image/png" },
    ],
    isError: false,
    timestamp: yield* Clock.currentTimeMillis,
  } satisfies ToolResultMessage);

  let capturedPayload: unknown;
  const secondResponse = yield* Effect.promise(() =>
    complete(model, context, {
      ...options,
      onPayload: (payload) => {
        capturedPayload = payload;
      },
    }),
  );

  expect(secondResponse.stopReason, `Error: ${secondResponse.errorMessage}`).toBe("stop");
  expect(secondResponse.errorMessage).toBeFalsy();

  const responsePayload = capturedPayload as CapturedResponsePayload | undefined;
  expect(Array.isArray(responsePayload?.input)).toBe(true);
  if (!Array.isArray(responsePayload?.input)) {
    throw new Error("Expected payload with input array");
  }
  const responseInput = responsePayload.input;

  const functionCallOutputIndex = responseInput.findIndex(
    (item) => (item as { type?: unknown } | null)?.type === "function_call_output",
  );
  expect(functionCallOutputIndex).toBeGreaterThanOrEqual(0);
  const functionCallOutput = responseInput[functionCallOutputIndex] as
    | FunctionCallOutputItem
    | undefined;
  if (functionCallOutput === undefined) {
    throw new Error("Expected function_call_output item");
  }

  expect(Array.isArray(functionCallOutput.output)).toBe(true);
  if (!Array.isArray(functionCallOutput.output)) {
    throw new Error("Expected function_call_output output to be a content array");
  }

  const outputItems = functionCallOutput.output;
  const textItem = outputItems.find(
    (item) => (item as { type?: unknown } | null)?.type === "input_text",
  ) as InputTextItem | undefined;
  const imageItem = outputItems.find(
    (item) => (item as { type?: unknown } | null)?.type === "input_image",
  ) as InputImageItem | undefined;

  expect(textItem).toBeTruthy();
  expect(imageItem).toBeTruthy();
  if (textItem === undefined || imageItem === undefined) {
    throw new Error("Expected both input_text and input_image in function_call_output");
  }

  expect(textItem.text).toContain(toolText);
  expect(imageItem.image_url.startsWith("data:image/png;base64,")).toBe(true);

  const laterUserMessages = responseInput
    .slice(functionCallOutputIndex + 1)
    .filter((item) => (item as { role?: unknown } | null)?.role === "user");
  expect(laterUserMessages).toHaveLength(0);

  const responseText = secondResponse.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .toLowerCase();
  expect(responseText).toContain("red");
  expect(responseText).toContain("circle");
});

describe("Responses API tool result images", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider (gpt-5-mini)",
    () => {
      const model = getModel("openai", "gpt-5-mini");

      it(
        "should send tool result images in function_call_output",
        { retry: 3, timeout: 30000 },
        () =>
          Effect.runPromise(
            verifyToolResultImagesStayInFunctionCallOutput(model, { reasoningEffort: "low" }),
          ),
      );
    },
  );

  describe.skipIf(!hasAzureOpenAICredentials())(
    "Azure OpenAI Responses Provider (gpt-4o-mini)",
    () => {
      const model = getModel("azure", "gpt-4o-mini");
      const azureDeploymentName = resolveAzureDeploymentName(model.id);
      const azureOptions =
        azureDeploymentName !== undefined && azureDeploymentName !== ""
          ? { azureDeploymentName }
          : {};

      it(
        "should send tool result images in function_call_output",
        { retry: 3, timeout: 30000 },
        () =>
          Effect.runPromise(verifyToolResultImagesStayInFunctionCallOutput(model, azureOptions)),
      );
    },
  );

  describe("OpenAI Codex Responses Provider (gpt-5.5)", () => {
    const model = getModel("openai-codex", "gpt-5.5");

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should send tool result images in function_call_output",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          verifyToolResultImagesStayInFunctionCallOutput(model, {
            apiKey: openaiCodexToken,
            reasoningEffort: "low",
          }),
        ),
    );
  });
});
