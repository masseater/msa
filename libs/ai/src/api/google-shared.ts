import {
  type Content,
  FinishReason,
  FunctionCallingConfigMode,
  ThinkingLevel as GoogleSdkThinkingLevel,
  type Part,
  type ThinkingConfig,
} from "@google/genai";
import { Effect, Function } from "effect";

import { clampThinkingLevel } from "../models.ts";
import type {
  ImageContent,
  Model,
  StopReason,
  StreamOptions,
  TextContent,
  ThinkingLevel,
  Tool,
  TranscriptContext,
} from "../types.ts";
import { retryProviderEffect } from "../utils/provider-retry.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { collapseSystemMessages, withoutInitialSystemMessage } from "../utils/transcript.ts";
import {
  getJsonSchemaToolParameters,
  resolveJsonSchemaStrictSampling,
} from "./constrained-sampling.ts";
import { transformMessages } from "./transform-messages.ts";

type GoogleApiType = "google-generative-ai" | "google-vertex";

export type GoogleApiThinkingLevel =
  | "THINKING_LEVEL_UNSPECIFIED"
  | "MINIMAL"
  | "LOW"
  | "MEDIUM"
  | "HIGH";
export type ResolvedGoogleThinkingLevel = Exclude<ThinkingLevel, "xhigh" | "max">;

const GOOGLE_SDK_THINKING_LEVEL_MAP: Record<GoogleApiThinkingLevel, GoogleSdkThinkingLevel> = {
  THINKING_LEVEL_UNSPECIFIED: GoogleSdkThinkingLevel.THINKING_LEVEL_UNSPECIFIED,
  MINIMAL: GoogleSdkThinkingLevel.MINIMAL,
  LOW: GoogleSdkThinkingLevel.LOW,
  MEDIUM: GoogleSdkThinkingLevel.MEDIUM,
  HIGH: GoogleSdkThinkingLevel.HIGH,
};

export const resolveGoogleThinkingLevel: {
  <T extends GoogleApiType>(level: ThinkingLevel): (model: Model<T>) => ResolvedGoogleThinkingLevel;
  <T extends GoogleApiType>(model: Model<T>, level: ThinkingLevel): ResolvedGoogleThinkingLevel;
} = Function.dual(2, function <
  T extends GoogleApiType,
>(model: Model<T>, level: ThinkingLevel): ResolvedGoogleThinkingLevel {
  const mapped = model.thinkingLevelMap?.[level];
  const resolvedLevel = typeof mapped === "string" ? mapped.toLowerCase() : level;
  switch (resolvedLevel) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
      return resolvedLevel;
    default:
      throw new Error(
        `Unsupported Google thinking level mapping for ${model.provider}/${model.id}: ${level} -> ${String(mapped)}`,
      );
  }
});

export function usesGoogleThinkingLevel<T extends GoogleApiType>(model: Model<T>): boolean {
  const id = model.id.toLowerCase();
  return (
    /gemini-3(?:\.\d+)?-(?:pro|flash)/u.test(id) ||
    /gemini-(?:[4-9]|[1-9]\d)/u.test(id) ||
    id === "gemini-flash-latest" ||
    id === "gemini-flash-lite-latest" ||
    /gemma-?4/u.test(id)
  );
}

export function toGoogleThinkingLevel(level: ResolvedGoogleThinkingLevel): GoogleApiThinkingLevel {
  switch (level) {
    case "minimal":
      return "MINIMAL";
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
  }
}

export function toGoogleSdkThinkingLevel(level: GoogleApiThinkingLevel): GoogleSdkThinkingLevel {
  return GOOGLE_SDK_THINKING_LEVEL_MAP[level];
}

export function getDisabledGoogleThinkingConfig<T extends GoogleApiType>(
  model: Model<T>,
): ThinkingConfig {
  if (!usesGoogleThinkingLevel(model)) return { thinkingBudget: 0 };

  const fallback = clampThinkingLevel(model, "off");
  if (fallback === "off") return { thinkingBudget: 0 };

  const resolvedLevel = resolveGoogleThinkingLevel(model, fallback);
  const apiLevel = toGoogleThinkingLevel(resolvedLevel);
  return { thinkingLevel: toGoogleSdkThinkingLevel(apiLevel) };
}

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

function getGeminiMajorVersion(modelId: string): number | undefined {
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

export const convertMessages: {
  <T extends GoogleApiType>(context: TranscriptContext): (model: Model<T>) => Content[];
  <T extends GoogleApiType>(model: Model<T>, context: TranscriptContext): Content[];
} = Function.dual(2, function <
  T extends GoogleApiType,
>(model: Model<T>, context: TranscriptContext): Content[] {
  const conversation = withoutInitialSystemMessage(collapseSystemMessages(context).messages);
  const contents: Content[] = [];
  const normalizeToolCallId = (id: string): string => {
    if (!requiresToolCallId(model.id)) return id;
    return id.replace(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length)).slice(0, 64);
  };

  const transformedMessages = transformMessages(conversation, model, normalizeToolCallId);

  for (const msg of transformedMessages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        contents.push({
          role: "user",
          parts: [{ text: sanitizeSurrogates(msg.content) }],
        });
      } else {
        const parts: Part[] = msg.content.map((item) => {
          if (item.type === "text") {
            return { text: sanitizeSurrogates(item.text) };
          }
          return {
            inlineData: {
              mimeType: item.mimeType,
              data: item.data,
            },
          };
        });
        if (parts.length === 0) continue;
        contents.push({
          role: "user",
          parts,
        });
      }
    } else if (msg.role === "assistant") {
      const parts: Part[] = [];
      const isSameProviderAndModel = msg.provider === model.provider && msg.model === model.id;

      for (const block of msg.content) {
        if (block.type === "text") {
          const thoughtSignature = resolveThoughtSignature(
            isSameProviderAndModel,
            block.textSignature,
          );
          if (
            (block.text === "" || block.text.trim() === "") &&
            (thoughtSignature === undefined || thoughtSignature === "")
          )
            continue;
          parts.push({
            text: sanitizeSurrogates(block.text),
            ...(thoughtSignature && { thoughtSignature }),
          });
        } else if (block.type === "thinking") {
          if (isSameProviderAndModel) {
            const thoughtSignature = resolveThoughtSignature(
              isSameProviderAndModel,
              block.thinkingSignature,
            );
            if (
              (block.thinking === "" || block.thinking.trim() === "") &&
              (thoughtSignature === undefined || thoughtSignature === "")
            )
              continue;
            parts.push({
              thought: true,
              text: sanitizeSurrogates(block.thinking),
              ...(thoughtSignature && { thoughtSignature }),
            });
          } else {
            if (block.thinking === "" || block.thinking.trim() === "") continue;
            parts.push({
              text: sanitizeSurrogates(block.thinking),
            });
          }
        } else if (block.type === "toolCall") {
          const thoughtSignature = resolveThoughtSignature(
            isSameProviderAndModel,
            block.thoughtSignature,
          );
          const part: Part = {
            functionCall: {
              name: block.name,
              args: block.arguments ?? {},
              ...(requiresToolCallId(model.id) ? { id: block.id } : {}),
            },
            ...(thoughtSignature && { thoughtSignature }),
          };
          parts.push(part);
        }
      }

      if (parts.length === 0) continue;
      contents.push({
        role: "model",
        parts,
      });
    } else if (msg.role === "toolResult") {
      const textContent = msg.content.filter((c): c is TextContent => c.type === "text");
      const textResult = textContent.map((c) => c.text).join("\n");
      const imageContent = model.input.includes("image")
        ? msg.content.filter((c): c is ImageContent => c.type === "image")
        : [];

      const hasText = textResult.length > 0;
      const hasImages = imageContent.length > 0;

      const modelSupportsMultimodalFunctionResponse = supportsMultimodalFunctionResponse(model.id);

      const responseValue = hasText
        ? sanitizeSurrogates(textResult)
        : hasImages
          ? "(see attached image)"
          : "";

      const imageParts: Part[] = imageContent.map((imageBlock) => ({
        inlineData: {
          mimeType: imageBlock.mimeType,
          data: imageBlock.data,
        },
      }));

      const includeId = requiresToolCallId(model.id);
      const functionResponsePart: Part = {
        functionResponse: {
          name: msg.toolName,
          response: msg.isError ? { error: responseValue } : { output: responseValue },
          ...(hasImages && modelSupportsMultimodalFunctionResponse && { parts: imageParts }),
          ...(includeId ? { id: msg.toolCallId } : {}),
        },
      };

      const lastContent = contents[contents.length - 1];
      if (
        lastContent?.role === "user" &&
        lastContent.parts?.some((p) => p.functionResponse) === true
      ) {
        lastContent.parts.push(functionResponsePart);
      } else {
        contents.push({
          role: "user",
          parts: [functionResponsePart],
        });
      }

      if (hasImages && !modelSupportsMultimodalFunctionResponse) {
        contents.push({
          role: "user",
          parts: [{ text: "Tool result image:" }, ...imageParts],
        });
      }
    }
  }

  return contents;
});

const JSON_SCHEMA_META_DECLARATIONS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
  "$defs",
  "definitions",
]);

function sanitizeForOpenApi(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return schema;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (JSON_SCHEMA_META_DECLARATIONS.has(key)) continue;
    result[key] = sanitizeForOpenApi(value);
  }
  return result;
}

export function convertTools(
  tools: Tool[],
  useParameters = false,
  supportsStrictMode = true,
): { functionDeclarations: Record<string, unknown>[] }[] | undefined {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => {
        const strict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
        const parameters = getJsonSchemaToolParameters(tool, strict);
        return {
          name: tool.name,
          description: tool.description,
          ...(useParameters
            ? { parameters: sanitizeForOpenApi(parameters as unknown) }
            : { parametersJsonSchema: parameters }),
        };
      }),
    },
  ];
}

export function supportsGoogleStrictToolSampling(modelId: string): boolean {
  const majorVersion = getGeminiMajorVersion(modelId);
  return majorVersion !== undefined && majorVersion >= 3;
}

export function mapToolChoice(choice: string): FunctionCallingConfigMode {
  switch (choice) {
    case "auto":
      return FunctionCallingConfigMode.AUTO;
    case "none":
      return FunctionCallingConfigMode.NONE;
    case "any":
      return FunctionCallingConfigMode.ANY;
    default:
      return FunctionCallingConfigMode.AUTO;
  }
}

export const resolveGoogleFunctionCallingMode: {
  (
    toolChoice: string | undefined,
    supportsStrictMode: boolean,
  ): (tools: Tool[]) => FunctionCallingConfigMode | undefined;
  (
    tools: Tool[],
    toolChoice: string | undefined,
    supportsStrictMode: boolean,
  ): FunctionCallingConfigMode | undefined;
} = Function.dual(
  3,
  function (
    tools: Tool[],
    toolChoice: string | undefined,
    supportsStrictMode: boolean,
  ): FunctionCallingConfigMode | undefined {
    const useStrictMode = tools.some(
      (tool) => resolveJsonSchemaStrictSampling(tool, supportsStrictMode) === true,
    );
    if (toolChoice === "none" || toolChoice === "any") {
      return mapToolChoice(toolChoice);
    }
    if (useStrictMode) {
      return FunctionCallingConfigMode.VALIDATED;
    }
    return toolChoice !== undefined && toolChoice !== "" ? mapToolChoice(toolChoice) : undefined;
  },
);

export function mapStopReason(reason: FinishReason): StopReason {
  switch (reason) {
    case FinishReason.STOP:
      return "stop";
    case FinishReason.MAX_TOKENS:
      return "length";
    case FinishReason.BLOCKLIST:
    case FinishReason.PROHIBITED_CONTENT:
    case FinishReason.SPII:
    case FinishReason.SAFETY:
    case FinishReason.IMAGE_SAFETY:
    case FinishReason.IMAGE_PROHIBITED_CONTENT:
    case FinishReason.IMAGE_RECITATION:
    case FinishReason.IMAGE_OTHER:
    case FinishReason.RECITATION:
    case FinishReason.FINISH_REASON_UNSPECIFIED:
    case FinishReason.OTHER:
    case FinishReason.LANGUAGE:
    case FinishReason.MALFORMED_FUNCTION_CALL:
    case FinishReason.UNEXPECTED_TOOL_CALL:
    case FinishReason.TOO_MANY_TOOL_CALLS:
    case FinishReason.NO_IMAGE:
      return "error";
    default: {
      const exhaustive: never = reason;
      throw new Error(`Unhandled stop reason: ${exhaustive}`);
    }
  }
}

export function mapStopReasonString(reason: string): StopReason {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    default:
      return "error";
  }
}

const withHeadersField = (error: unknown): unknown => {
  if (error instanceof Error && "status" in error && !("headers" in error)) {
    (error as { headers?: Headers | undefined }).headers = undefined;
  }
  return error;
};

export const retryGoogleRequest = <T>(
  request: () => Promise<T>,
  options?: Pick<StreamOptions, "maxRetries" | "maxRetryDelayMs" | "signal">,
): Effect.Effect<T> =>
  retryProviderEffect(
    Effect.promise(() => Promise.resolve(request())).pipe(
      Effect.catchDefect((error) => Effect.die(withHeadersField(error))),
    ),
    {
      maxRetries: options?.maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      signal: options?.signal,
    },
  );
