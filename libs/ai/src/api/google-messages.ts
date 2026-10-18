import type { Content, Part } from "@google/genai";
import { Function } from "effect";

import type {
  AssistantMessage,
  ImageContent,
  Model,
  TextContent,
  ToolResultMessage,
  TranscriptContext,
  UserMessage,
} from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { collapseSystemMessages, withoutInitialSystemMessage } from "../utils/transcript.ts";
import type { GoogleApiType } from "./google-thinking.ts";
import { transformMessages } from "./transform-messages.ts";

export function isThinkingPart(part: Pick<Part, "thought" | "thoughtSignature">): boolean {
  return part.thought === true;
}

export const retainThoughtSignature: {
  (incoming: string | undefined): (existing: string | undefined) => string | undefined;
  (existing: string | undefined, incoming: string | undefined): string | undefined;
} = Function.dual(2, function (existing: string | undefined, incoming: string | undefined):
  | string
  | undefined {
  if (typeof incoming === "string" && incoming.length > 0) return incoming;
  return existing;
});

const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/u;

function isValidThoughtSignature(signature: string | undefined): boolean {
  if (signature === undefined || signature === "") return false;
  if (signature.length % 4 !== 0) return false;
  return base64SignaturePattern.test(signature);
}

function resolveThoughtSignature(
  isSameProviderAndModel: boolean,
  signature: string | undefined,
): string | undefined {
  return isSameProviderAndModel && isValidThoughtSignature(signature) ? signature : undefined;
}

export function requiresToolCallId(modelId: string): boolean {
  const geminiMajorVersion = getGeminiMajorVersion(modelId);
  return (
    modelId.startsWith("claude-") ||
    modelId.startsWith("gpt-oss-") ||
    (geminiMajorVersion !== undefined && geminiMajorVersion >= 3)
  );
}

export function getGeminiMajorVersion(modelId: string): number | undefined {
  const major = modelId.toLowerCase().match(/^gemini(?:-live)?-(\d+)/u)?.[1];
  if (major === undefined) return undefined;
  return Number.parseInt(major, 10);
}

function supportsMultimodalFunctionResponse(modelId: string): boolean {
  const geminiMajorVersion = getGeminiMajorVersion(modelId);
  if (geminiMajorVersion !== undefined) {
    return geminiMajorVersion >= 3;
  }
  return true;
}

function userContent(message: UserMessage): Content | undefined {
  if (typeof message.content === "string") {
    return { role: "user", parts: [{ text: sanitizeSurrogates(message.content) }] };
  }
  const parts: Part[] = message.content.map((item) =>
    item.type === "text"
      ? { text: sanitizeSurrogates(item.text) }
      : { inlineData: { mimeType: item.mimeType, data: item.data } },
  );
  return parts.length === 0 ? undefined : { role: "user", parts };
}

const isBlank = (text: string): boolean => text.trim() === "";

const withSignature = (part: Part, thoughtSignature: string | undefined): Part =>
  thoughtSignature === undefined || thoughtSignature === "" ? part : { ...part, thoughtSignature };

interface AssistantPartContext {
  readonly sameModel: boolean;
  readonly includeToolCallId: boolean;
}

type AssistantBlock = AssistantMessage["content"][number];

function assistantPart(block: AssistantBlock, context: AssistantPartContext): Part | undefined {
  const { sameModel } = context;
  if (block.type === "text") {
    const thoughtSignature = resolveThoughtSignature(sameModel, block.textSignature);
    if (isBlank(block.text) && (thoughtSignature === undefined || thoughtSignature === "")) {
      return undefined;
    }
    return withSignature({ text: sanitizeSurrogates(block.text) }, thoughtSignature);
  }
  if (block.type === "thinking") {
    const thoughtSignature = resolveThoughtSignature(sameModel, block.thinkingSignature);
    if (!sameModel) {
      return isBlank(block.thinking) ? undefined : { text: sanitizeSurrogates(block.thinking) };
    }
    if (isBlank(block.thinking) && (thoughtSignature === undefined || thoughtSignature === "")) {
      return undefined;
    }
    return withSignature(
      { thought: true, text: sanitizeSurrogates(block.thinking) },
      thoughtSignature,
    );
  }
  return withSignature(
    {
      functionCall: {
        name: block.name,
        args: block.arguments ?? {},
        ...(context.includeToolCallId ? { id: block.id } : {}),
      },
    },
    resolveThoughtSignature(sameModel, block.thoughtSignature),
  );
}

function assistantContent<T extends GoogleApiType>(
  message: AssistantMessage,
  model: Model<T>,
): Content | undefined {
  const context: AssistantPartContext = {
    sameModel: message.provider === model.provider && message.model === model.id,
    includeToolCallId: requiresToolCallId(model.id),
  };
  const parts = message.content.flatMap((block) => assistantPart(block, context) ?? []);
  return parts.length === 0 ? undefined : { role: "model", parts };
}

function toolResultValue(message: ToolResultMessage, hasImages: boolean): string {
  const textResult = message.content
    .filter((content): content is TextContent => content.type === "text")
    .map((content) => content.text)
    .join("\n");
  if (textResult.length > 0) return sanitizeSurrogates(textResult);
  return hasImages ? "(see attached image)" : "";
}

function appendToolResult<T extends GoogleApiType>(
  contents: Content[],
  message: ToolResultMessage,
  model: Model<T>,
): void {
  const imageParts: Part[] = (model.input.includes("image") ? message.content : [])
    .filter((content): content is ImageContent => content.type === "image")
    .map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } }));
  const hasImages = imageParts.length > 0;
  const multimodalResponse = supportsMultimodalFunctionResponse(model.id);
  const responseValue = toolResultValue(message, hasImages);
  const functionResponsePart: Part = {
    functionResponse: {
      name: message.toolName,
      response: message.isError ? { error: responseValue } : { output: responseValue },
      ...(hasImages && multimodalResponse && { parts: imageParts }),
      ...(requiresToolCallId(model.id) ? { id: message.toolCallId } : {}),
    },
  };
  const lastContent = contents.at(-1);
  if (
    lastContent?.role === "user" &&
    lastContent.parts?.some((part) => part.functionResponse) === true
  ) {
    lastContent.parts.push(functionResponsePart);
  } else {
    contents.push({ role: "user", parts: [functionResponsePart] });
  }
  if (hasImages && !multimodalResponse) {
    contents.push({ role: "user", parts: [{ text: "Tool result image:" }, ...imageParts] });
  }
}

export const convertMessages: {
  <T extends GoogleApiType>(context: TranscriptContext): (model: Model<T>) => Content[];
  <T extends GoogleApiType>(model: Model<T>, context: TranscriptContext): Content[];
} = Function.dual(2, function <
  T extends GoogleApiType,
>(model: Model<T>, context: TranscriptContext): Content[] {
  const conversation = withoutInitialSystemMessage(collapseSystemMessages(context).messages);
  const normalizeToolCallId = (id: string): string => {
    if (!requiresToolCallId(model.id)) return id;
    return id.replace(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length)).slice(0, 64);
  };
  const contents: Content[] = [];
  for (const message of transformMessages(conversation, model, normalizeToolCallId)) {
    if (message.role === "toolResult") {
      appendToolResult(contents, message, model);
      continue;
    }
    const content =
      message.role === "user"
        ? userContent(message)
        : message.role === "assistant"
          ? assistantContent(message, model)
          : undefined;
    if (content !== undefined) contents.push(content);
  }
  return contents;
});
