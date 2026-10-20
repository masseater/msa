import { Clock, Console, Effect } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";

import compat from "../src/compat.ts";
import type compatTypes from "../src/compat.types.ts";
import type messageTypesModule from "../src/message-types.types.ts";
import type typesModule from "../src/types.types.ts";
import redCircle from "./red-circle.ts";

const { complete } = compat;

type StreamOptionsWithExtras = typesModule.StreamOptions & Record<string, unknown>;

const handleToolWithImageResult = Effect.fn("handleToolWithImageResult")(function* <
  TApi extends compatTypes.Api,
>(model: compatTypes.Model<TApi>, options?: StreamOptionsWithExtras) {
  if (!model.input.includes("image")) {
    yield* Console.log(
      `Skipping tool image result test - model ${model.id} doesn't support images`,
    );
    return;
  }

  const {
    base64Image,
    toolCall,
    context,
  }: {
    base64Image: string;
    toolCall: messageTypesModule.ToolCall | undefined;
    context: compatTypes.Context;
  } = yield* handleToolWithImageResultStep1<TApi>(model, options);

  const toolResult: compatTypes.ToolResultMessage = {
    content: [
      {
        data: base64Image,
        mimeType: "image/png",
        type: "image",
      },
    ],
    isError: false,
    role: "toolResult",
    timestamp: yield* Clock.currentTimeMillis,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  };

  context.messages.push(toolResult);

  const secondResponse = yield* Effect.promise(() => complete(model, context, options));
  expect(secondResponse.stopReason).toBe("stop");
  expect(secondResponse.errorMessage).toBeFalsy();

  const textContent = secondResponse.content.find((b) => b.type === "text");
  expect(textContent).toBeTruthy();
  if (textContent?.type === "text") {
    const lowerContent = textContent.text.toLowerCase();
    expect(lowerContent).toContain("red");
    expect(lowerContent).toContain("circle");
  }
});

const handleToolWithTextAndImageResult = Effect.fn("handleToolWithTextAndImageResult")(function* <
  TApi extends compatTypes.Api,
>(model: compatTypes.Model<TApi>, options?: StreamOptionsWithExtras) {
  if (!model.input.includes("image")) {
    yield* Console.log(
      `Skipping tool text+image result test - model ${model.id} doesn't support images`,
    );
    return;
  }

  yield* handleToolWithTextAndImageResultStep2<TApi>(model, options);
});

function* handleToolWithTextAndImageResultStep2<TApi extends compatTypes.Api>(
  model: compatTypes.Model<TApi>,
  options: StreamOptionsWithExtras | undefined,
) {
  const {
    base64Image,
    toolCall,
    context,
  }: {
    base64Image: string;
    toolCall: messageTypesModule.ToolCall | undefined;
    context: compatTypes.Context;
  } = yield* handleToolWithTextAndImageResultStep1<TApi>(model, options);

  const toolResult: compatTypes.ToolResultMessage = {
    content: [
      {
        text: "This is a geometric shape with specific properties: it has a diameter of 100 pixels.",
        type: "text",
      },
      {
        data: base64Image,
        mimeType: "image/png",
        type: "image",
      },
    ],
    isError: false,
    role: "toolResult",
    timestamp: yield* Clock.currentTimeMillis,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  };

  context.messages.push(toolResult);

  const secondResponse = yield* Effect.promise(() => complete(model, context, options));
  expect(secondResponse.stopReason).toBe("stop");
  expect(secondResponse.errorMessage).toBeFalsy();

  const textContent = secondResponse.content.find((b) => b.type === "text");
  expect(textContent).toBeTruthy();
  if (textContent?.type === "text") {
    const lowerContent = textContent.text.toLowerCase();
    expect(lowerContent.match(/diameter|100|pixel/u)).toBeTruthy();
    expect(lowerContent).toContain("red");
    expect(lowerContent).toContain("circle");
  }
}

function* handleToolWithTextAndImageResultStep1<TApi extends compatTypes.Api>(
  model: compatTypes.Model<TApi>,
  options: StreamOptionsWithExtras | undefined,
) {
  const base64Image = redCircle.data;

  const getImageSchema = Type.Object({});
  const getImageTool: compatTypes.Tool<typeof getImageSchema> = {
    description: "Returns a circle image with a text description",
    name: "get_circle_with_description",
    parameters: getImageSchema,
  };

  const context: compatTypes.Context = {
    messages: [
      {
        content:
          "Use the get_circle_with_description tool and tell me what you learned. Also say what color the shape is.",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: "You are a helpful assistant that uses tools when asked.",
    tools: [getImageTool],
  };

  const firstResponse = yield* Effect.promise(() => complete(model, context, options));
  expect(firstResponse.stopReason).toBe("toolUse");

  const toolCall = firstResponse.content.find((b) => b.type === "toolCall");
  expect(toolCall).toBeTruthy();
  if (toolCall === undefined || toolCall.type !== "toolCall") {
    throw new Error("Expected tool call");
  }
  expect(toolCall.name).toBe("get_circle_with_description");

  context.messages.push(firstResponse);
  return { base64Image, context, toolCall };
}

function* handleToolWithImageResultStep1<TApi extends compatTypes.Api>(
  model: compatTypes.Model<TApi>,
  options: StreamOptionsWithExtras | undefined,
) {
  const base64Image = redCircle.data;

  const getImageSchema = Type.Object({});
  const getImageTool: compatTypes.Tool<typeof getImageSchema> = {
    description: "Returns a circle image for visualization",
    name: "get_circle",
    parameters: getImageSchema,
  };

  const context: compatTypes.Context = {
    messages: [
      {
        content:
          "Call the get_circle tool to get an image, and describe what you see, shapes, colors, etc.",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: "You are a helpful assistant that uses tools when asked.",
    tools: [getImageTool],
  };

  const firstResponse = yield* Effect.promise(() => complete(model, context, options));
  expect(firstResponse.stopReason).toBe("toolUse");

  const toolCall = firstResponse.content.find((b) => b.type === "toolCall");
  expect(toolCall).toBeTruthy();
  if (toolCall === undefined || toolCall.type !== "toolCall") {
    throw new Error("Expected tool call");
  }
  expect(toolCall.name).toBe("get_circle");

  context.messages.push(firstResponse);
  return { base64Image, context, toolCall };
}

const imageToolResultSupport = {
  handleToolWithImageResult,
  handleToolWithImageResultStep1,
  handleToolWithTextAndImageResult,
  handleToolWithTextAndImageResultStep1,
  handleToolWithTextAndImageResultStep2,
};

export default imageToolResultSupport;
