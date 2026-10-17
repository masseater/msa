import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Clock, Console, Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import type { Api, Context, Model, Tool, ToolResultMessage } from "../src/compat.ts";
import { complete, getModel } from "../src/compat.ts";
import type { StreamOptions } from "../src/types.ts";
import { envValue } from "./env.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { hasAzureOpenAICredentials, resolveAzureDeploymentName } from "./azure-utils.ts";
import { hasBedrockCredentials } from "./bedrock-utils.ts";
import { resolveApiKey } from "./oauth.ts";

const oauthTokens = await Promise.all([resolveApiKey("anthropic"), resolveApiKey("openai-codex")]);
const [anthropicOAuthToken, openaiCodexToken] = oauthTokens;

const handleToolWithImageResult = Effect.fn("handleToolWithImageResult")(function* <
  TApi extends Api,
>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
  if (!model.input.includes("image")) {
    yield* Console.log(
      `Skipping tool image result test - model ${model.id} doesn't support images`,
    );
    return;
  }

  const imagePath = join(__dirname, "data", "red-circle.png");
  const imageBuffer = readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const getImageSchema = Type.Object({});
  const getImageTool: Tool<typeof getImageSchema> = {
    name: "get_circle",
    description: "Returns a circle image for visualization",
    parameters: getImageSchema,
  };

  const context: Context = {
    systemPrompt: "You are a helpful assistant that uses tools when asked.",
    messages: [
      {
        role: "user",
        content:
          "Call the get_circle tool to get an image, and describe what you see, shapes, colors, etc.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
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

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [
      {
        type: "image",
        data: base64Image,
        mimeType: "image/png",
      },
    ],
    isError: false,
    timestamp: yield* Clock.currentTimeMillis,
  };

  context.messages.push(toolResult);

  const secondResponse = yield* Effect.promise(() => complete(model, context, options));
  expect(secondResponse.stopReason).toBe("stop");
  expect(secondResponse.errorMessage).toBeFalsy();

  const textContent = secondResponse.content.find((b) => b.type === "text");
  expect(textContent).toBeTruthy();
  if (textContent !== undefined && textContent.type === "text") {
    const lowerContent = textContent.text.toLowerCase();
    expect(lowerContent).toContain("red");
    expect(lowerContent).toContain("circle");
  }
});

const handleToolWithTextAndImageResult = Effect.fn("handleToolWithTextAndImageResult")(function* <
  TApi extends Api,
>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
  if (!model.input.includes("image")) {
    yield* Console.log(
      `Skipping tool text+image result test - model ${model.id} doesn't support images`,
    );
    return;
  }

  const imagePath = join(__dirname, "data", "red-circle.png");
  const imageBuffer = readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const getImageSchema = Type.Object({});
  const getImageTool: Tool<typeof getImageSchema> = {
    name: "get_circle_with_description",
    description: "Returns a circle image with a text description",
    parameters: getImageSchema,
  };

  const context: Context = {
    systemPrompt: "You are a helpful assistant that uses tools when asked.",
    messages: [
      {
        role: "user",
        content:
          "Use the get_circle_with_description tool and tell me what you learned. Also say what color the shape is.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
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

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [
      {
        type: "text",
        text: "This is a geometric shape with specific properties: it has a diameter of 100 pixels.",
      },
      {
        type: "image",
        data: base64Image,
        mimeType: "image/png",
      },
    ],
    isError: false,
    timestamp: yield* Clock.currentTimeMillis,
  };

  context.messages.push(toolResult);

  const secondResponse = yield* Effect.promise(() => complete(model, context, options));
  expect(secondResponse.stopReason).toBe("stop");
  expect(secondResponse.errorMessage).toBeFalsy();

  const textContent = secondResponse.content.find((b) => b.type === "text");
  expect(textContent).toBeTruthy();
  if (textContent !== undefined && textContent.type === "text") {
    const lowerContent = textContent.text.toLowerCase();
    expect(lowerContent.match(/diameter|100|pixel/u)).toBeTruthy();
    expect(lowerContent).toContain("red");
    expect(lowerContent).toContain("circle");
  }
});

describe("Tool Results with Images", () => {
  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Google Provider (gemini-2.5-flash)",
    () => {
      const llm = getModel("google", "gemini-2.5-flash");

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm)),
      );

      it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm)),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider (gpt-4o-mini)",
    () => {
      const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
      void _compat;
      const llm: Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm)),
      );

      it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm)),
      );
    },
  );
});

describe("Tool Results with Images", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider (gpt-5-mini)",
    () => {
      const llm = getModel("openai", "gpt-5-mini");

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm)),
      );

      it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm)),
      );
    },
  );
});

describe("Tool Results with Images", () => {
  describe.skipIf(!hasAzureOpenAICredentials())(
    "Azure OpenAI Responses Provider (gpt-4o-mini)",
    () => {
      const llm = getModel("azure", "gpt-4o-mini");
      const azureDeploymentName = resolveAzureDeploymentName(llm.id);
      const azureOptions =
        azureDeploymentName !== undefined && azureDeploymentName !== ""
          ? { azureDeploymentName }
          : {};

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm, azureOptions)),
      );

      it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm, azureOptions)),
      );
    },
  );

  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider (claude-haiku-4-5)", () => {
    const model = getModel("anthropic", "claude-haiku-4-5");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(model)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(model)),
    );
  });

  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter Provider (glm-4.5v)", () => {
    const llm = getModel("openrouter", "z-ai/glm-4.5v");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });
});

describe("Tool Results with Images", () => {
  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral Provider (pixtral-12b)",
    () => {
      const llm = getModel("mistral", "pixtral-12b");

      it("should handle tool result with only image", { retry: 5, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm)),
      );

      it("should handle tool result with text and image", { retry: 5, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("TOGETHER_API_KEY") === undefined || envValue("TOGETHER_API_KEY") === "",
  )("Together AI Provider (Kimi-K3)", () => {
    const llm = getModel("together", "moonshotai/Kimi-K3");
    const options = { reasoningEffort: "high" } satisfies StreamOptionsWithExtras;

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm, options)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm, options)),
    );
  });

  describe.skipIf(envValue("BASETEN_API_KEY") === undefined || envValue("BASETEN_API_KEY") === "")(
    "Baseten Provider (Kimi-K2.6)",
    () => {
      const llm = getModel("baseten", "moonshotai/Kimi-K2.6");
      const options = { reasoningEffort: "high" } satisfies StreamOptionsWithExtras;

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm, options)),
      );

      it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm, options)),
      );
    },
  );
});

describe("Tool Results with Images", () => {
  describe.skipIf(envValue("XIAOMI_API_KEY") === undefined || envValue("XIAOMI_API_KEY") === "")(
    "Xiaomi MiMo (API billing) Provider (mimo-v2.6-pro)",
    () => {
      const llm = getModel("xiaomi", "mimo-v2.6-pro");

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm)),
      );

      it.skip("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (CN) Provider (mimo-v2.6-pro)", () => {
    const llm = getModel("xiaomi-token-plan-cn", "mimo-v2.6-pro");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it.skip("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (AMS) Provider (mimo-v2.6-pro)", () => {
    const llm = getModel("xiaomi-token-plan-ams", "mimo-v2.6-pro");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it.skip("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });
});

describe("Tool Results with Images", () => {
  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (SGP) Provider (mimo-v2.6-pro)", () => {
    const llm = getModel("xiaomi-token-plan-sgp", "mimo-v2.6-pro");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it.skip("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Provider (qwen3.7-max)", () => {
    const llm = getModel("qwen-token-plan", "qwen3.7-max");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Individual Provider (qwen3.8-max)", () => {
    const llm = getModel("qwen-token-plan-individual", "qwen3.8-max");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });
});

describe("Tool Results with Images", () => {
  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === "",
  )("Qwen Token Plan (CN) Provider (qwen3.7-max)", () => {
    const llm = getModel("qwen-token-plan-cn", "qwen3.7-max");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });

  describe.skipIf(envValue("KIMI_API_KEY") === undefined || envValue("KIMI_API_KEY") === "")(
    "Kimi For Coding Provider (kimi-for-coding)",
    () => {
      const llm = getModel("kimi-coding", "kimi-for-coding");

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm)),
      );

      it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway Provider (google/gemini-2.5-flash)", () => {
    const llm = getModel("vercel-ai-gateway", "google/gemini-2.5-flash");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });
});

describe("Tool Results with Images", () => {
  describe.skipIf(!hasBedrockCredentials())("Amazon Bedrock Provider (claude-sonnet-4-5)", () => {
    const llm = getModel("amazon-bedrock", "global.anthropic.claude-sonnet-4-5-20250929-v1:0");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });

  describe("Anthropic OAuth Provider (claude-sonnet-4-5)", () => {
    const model = getModel("anthropic", "claude-sonnet-4-5");

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle tool result with only image",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(handleToolWithImageResult(model, { apiKey: anthropicOAuthToken })),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle tool result with text and image",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(handleToolWithTextAndImageResult(model, { apiKey: anthropicOAuthToken })),
    );
  });
});

describe("Tool Results with Images", () => {
  describe("OpenAI Codex Provider", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle tool result with only image",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* handleToolWithImageResult(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle tool result with text and image",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* handleToolWithTextAndImageResult(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );
  });
});
