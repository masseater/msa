import type { Agent as HttpsAgent } from "node:https";

import {
  BedrockRuntimeClient,
  type BedrockRuntimeClientConfig,
  BedrockRuntimeServiceException,
  StopReason as BedrockStopReason,
  type Tool as BedrockTool,
  CachePointType,
  CacheTTL,
  type ContentBlock,
  type ContentBlockDeltaEvent,
  type ContentBlockStartEvent,
  type ContentBlockStopEvent,
  ConversationRole,
  ConverseStreamCommand,
  type ConverseStreamMetadataEvent,
  ImageFormat,
  type Message,
  type SystemContentBlock,
  type ToolChoice,
  type ToolConfiguration,
  type ToolResultContentBlock,
  ToolResultStatus,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type {
  BuildMiddleware,
  DeserializeMiddleware,
  DocumentType,
  HttpResponse,
  MetadataBearer,
} from "@smithy/types";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

import { calculateCost } from "../models.ts";
import type {
  Api,
  AssistantMessage,
  CacheRetention,
  ImageContent,
  JsonObject,
  JsonValue,
  Model,
  ProviderEnv,
  ProviderResponse,
  SimpleStreamOptions,
  StopReason,
  StreamFunction,
  StreamOptions,
  TextContent,
  ThinkingBudgets,
  ThinkingContent,
  ThinkingLevel,
  Tool,
  ToolCall,
} from "../types.ts";
import { appendAssistantMessageDiagnostic } from "../utils/diagnostics.ts";
import { normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";
import { parseStreamingJson, parseToolCallArguments } from "../utils/json-parse.ts";
import { resolveHttpProxyUrlForTarget } from "../utils/node-http-proxy.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getSystemMessageText } from "../utils/text.ts";
import {
  collapseSystemMessages,
  getCurrentTools,
  getInitialSystemMessage,
  type TranscriptContext,
  withoutInitialSystemMessage,
} from "../utils/transcript.ts";
import {
  getJsonSchemaToolParameters,
  resolveJsonSchemaStrictSampling,
} from "./constrained-sampling.ts";
import {
  adjustMaxTokensForThinking,
  buildBaseOptions,
  clampMaxTokensToContext,
  clampReasoning,
} from "./simple-options.ts";
import { transformMessages } from "./transform-messages.ts";

export type BedrockThinkingDisplay = "summarized" | "omitted";

export interface BedrockOptions extends StreamOptions {
  region?: string | undefined;
  profile?: string | undefined;
  toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string } | undefined;
  reasoning?: ThinkingLevel | undefined;
  thinkingBudgets?: ThinkingBudgets | undefined;
  interleavedThinking?: boolean | undefined;
  thinkingDisplay?: BedrockThinkingDisplay | undefined;
  requestMetadata?: Record<string, string> | undefined;
  bearerToken?: string | undefined;
}

type Block = (TextContent | ThinkingContent | ToolCall) & {
  index?: number;
  partialJson?: string;
  redactedChunks?: Uint8Array[];
};

const EMPTY_TEXT_PLACEHOLDER = "<empty>";

const THINKING_BINDING_CONTROLS_BETA = "thinking-binding-controls-2026-08-01";

const REDACTED_THINKING_PLACEHOLDER = "[Reasoning redacted]";

export const stream: StreamFunction<"bedrock-converse-stream", BedrockOptions> = (
  model: Model<"bedrock-converse-stream">,
  context: TranscriptContext,
  options: BedrockOptions = {},
): AssistantMessageEventStream => {
  const events = new AssistantMessageEventStream();
  const normalizedContext = collapseSystemMessages(context);

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "bedrock-converse-stream" as Api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "pending",
      timestamp: Date.now(),
    };

    const blocks = output.content as Block[];

    const optionsProfile = options.profile || options.env?.["AWS_PROFILE"];
    const profile = optionsProfile || getProviderEnvValue("AWS_PROFILE", options.env);
    const config: BedrockRuntimeClientConfig = {
      ...(profile === undefined ? {} : { profile }),
    };
    const configuredRegion = getConfiguredBedrockRegion(options);
    const hasAmbientConfiguredProfile = Boolean(getProviderEnvValue("AWS_PROFILE"));
    const endpointRegion = getStandardBedrockEndpointRegion(model.baseUrl);
    const useExplicitEndpoint = shouldUseExplicitBedrockEndpoint(
      model.baseUrl,
      configuredRegion,
      hasAmbientConfiguredProfile,
    );

    if (useExplicitEndpoint) {
      config.endpoint = model.baseUrl;
    }

    const skipAuth = getProviderEnvValue("AWS_BEDROCK_SKIP_AUTH", options.env) === "1";
    const bearerToken =
      options.bearerToken ||
      options.apiKey ||
      getProviderEnvValue("AWS_BEARER_TOKEN_BEDROCK", options.env) ||
      undefined;
    const useBearerToken = bearerToken !== undefined && !skipAuth;

    if (typeof process !== "undefined" && (process.versions?.node || process.versions?.["bun"])) {
      const arnRegion = model.id.match(/^arn:aws(?:-[a-z0-9-]+)?:bedrock:([a-z0-9-]+):/u)?.[1];
      if (arnRegion !== undefined && arnRegion !== "") {
        config.region = arnRegion;
      } else if (configuredRegion !== undefined && configuredRegion !== "") {
        config.region = configuredRegion;
      } else if (endpointRegion !== undefined && endpointRegion !== "" && useExplicitEndpoint) {
        config.region = endpointRegion;
      } else if (!hasAmbientConfiguredProfile) {
        config.region = "us-east-1";
      }

      if (skipAuth) {
        config.credentials = {
          accessKeyId: "dummy-access-key",
          secretAccessKey: "dummy-secret-key",
        };
      }

      const credentials = getConfiguredBedrockCredentials(options.env);
      if (
        !skipAuth &&
        credentials !== undefined &&
        (optionsProfile === undefined || optionsProfile === "")
      ) {
        config.credentials = credentials;
      }

      const proxyUrl = resolveHttpProxyUrlForTarget(model.baseUrl, options.env);
      if (proxyUrl !== undefined) {
        config.requestHandler = new NodeHttpHandler({
          httpAgent: new HttpProxyAgent(proxyUrl),
          httpsAgent: new HttpsProxyAgent(proxyUrl) as unknown as HttpsAgent,
        });
      } else if (getProviderEnvValue("AWS_BEDROCK_FORCE_HTTP1", options.env) === "1") {
        config.requestHandler = new NodeHttpHandler();
      }
    } else {
      config.region =
        configuredRegion ||
        (endpointRegion !== undefined && endpointRegion !== "" && useExplicitEndpoint
          ? endpointRegion
          : undefined) ||
        "us-east-1";
    }

    if (useBearerToken) {
      config.token = { token: bearerToken };
      config.authSchemePreference = ["httpBearerAuth"];
    }

    let responseRequestId: string | undefined;

    try {
      const supportsStrictMode = model.compat?.supportsStrictMode ?? false;
      const client = new BedrockRuntimeClient(config);
      let observedRawResponse = false;
      if (options.onResponse !== undefined) {
        addResponseHeadersMiddleware(client, options.onResponse, model, () => {
          observedRawResponse = true;
        });
      }
      const customHeaders = providerHeadersToRecord(options.headers);
      if (customHeaders !== undefined) {
        addCustomHeadersMiddleware(client, customHeaders);
      }
      const cacheRetention = resolveCacheRetention(options.cacheRetention, options.env);
      const inferenceMaxTokens =
        options.maxTokens ?? (isAnthropicClaudeModel(model) ? model.maxTokens : undefined);
      const initialSystemMessage = getInitialSystemMessage(normalizedContext.messages);
      const initialSystemPrompt =
        initialSystemMessage === undefined ? undefined : getSystemMessageText(initialSystemMessage);
      let commandInput = {
        modelId: model.id,
        messages: convertMessages(normalizedContext, model, cacheRetention, options.env),
        system: buildSystemPrompt(initialSystemPrompt, model, cacheRetention, options.env),
        inferenceConfig: {
          ...(inferenceMaxTokens !== undefined && { maxTokens: inferenceMaxTokens }),
          ...(options.temperature !== undefined && { temperature: options.temperature }),
        },
        toolConfig: convertToolConfig(
          getCurrentTools(normalizedContext.messages),
          options.toolChoice,
          supportsStrictMode,
        ),
        additionalModelRequestFields: buildAdditionalModelRequestFields(model, options),
        ...(options.requestMetadata !== undefined && { requestMetadata: options.requestMetadata }),
      };
      const nextCommandInput = await options?.onPayload?.(commandInput, model);
      if (nextCommandInput !== undefined) {
        commandInput = nextCommandInput as typeof commandInput;
      }
      const command = new ConverseStreamCommand(commandInput);

      const response = await client.send(
        command,
        options.signal === undefined ? {} : { abortSignal: options.signal },
      );
      responseRequestId = normalizeDiagnosticValue(response.$metadata.requestId);
      if (!observedRawResponse && response.$metadata.httpStatusCode !== undefined) {
        const responseHeaders: Record<string, string> = {};
        if (response.$metadata.requestId !== undefined && response.$metadata.requestId !== "") {
          responseHeaders["x-amzn-requestid"] = response.$metadata.requestId;
        }
        await options?.onResponse?.(
          { status: response.$metadata.httpStatusCode, headers: responseHeaders },
          model,
        );
      }

      for await (const item of response.stream!) {
        await options.onProviderStreamEvent?.(item, model);
        if (item.messageStart !== undefined) {
          if (item.messageStart.role !== ConversationRole.ASSISTANT) {
            throw new Error(
              "Unexpected assistant message start but got user message start instead",
            );
          }
          events.push({ type: "start", partial: output });
        } else if (item.contentBlockStart !== undefined) {
          handleContentBlockStart(item.contentBlockStart, blocks, output, events);
        } else if (item.contentBlockDelta !== undefined) {
          handleContentBlockDelta(item.contentBlockDelta, blocks, output, events);
        } else if (item.contentBlockStop !== undefined) {
          handleContentBlockStop(item.contentBlockStop, blocks, output, events);
        } else if (item.messageStop !== undefined) {
          output.rawStopReason = item.messageStop.stopReason;
          const { stopReason, errorMessage } = mapStopReason(item.messageStop.stopReason);
          output.stopReason = stopReason;
          if (errorMessage !== undefined && errorMessage !== "") {
            output.errorMessage = errorMessage;
          }
        } else if (item.metadata !== undefined) {
          handleMetadata(item.metadata, model, output);
        } else if (item.internalServerException !== undefined) {
          throw item.internalServerException;
        } else if (item.modelStreamErrorException !== undefined) {
          throw item.modelStreamErrorException;
        } else if (item.validationException !== undefined) {
          throw item.validationException;
        } else if (item.throttlingException !== undefined) {
          throw item.throttlingException;
        } else if (item.serviceUnavailableException !== undefined) {
          throw item.serviceUnavailableException;
        }
      }

      if (options.signal?.aborted === true) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "pending") {
        throw new Error("Bedrock stream ended without a stop reason");
      }
      if (output.stopReason === "error" || output.stopReason === "aborted") {
        throw new Error(output.errorMessage || "An unknown error occurred");
      }

      for (const block of output.content) finalizeStreamingBlock(block as Block);
      events.push({ type: "done", reason: output.stopReason, message: output });
      events.end();
    } catch (error) {
      for (const block of output.content) {
        finalizeStreamingBlock(block as Block);
      }
      output.stopReason = options.signal?.aborted === true ? "aborted" : "error";
      output.errorMessage = formatBedrockError(error);
      if (output.stopReason === "error") {
        appendBedrockFailureDiagnostic(output, error, responseRequestId);
      }
      events.push({ type: "error", reason: output.stopReason, error: output });
      events.end();
    }
  })();

  return events;
};

const BEDROCK_ERROR_PREFIXES: Record<string, string> = {
  InternalServerException: "Internal server error",
  ModelStreamErrorException: "Model stream error",
  ValidationException: "Validation error",
  ThrottlingException: "Throttling error",
  ServiceUnavailableException: "Service unavailable",
};

const BEDROCK_DATA_RETENTION_DOCS_URL =
  "https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html";

function formatBedrockError(error: unknown): string {
  const norm = normalizeProviderError(error);
  const core =
    !norm.messageCarriesBody && norm.status !== undefined && norm.body !== undefined
      ? `${norm.status}: ${norm.body}`
      : norm.message;
  const dataRetentionHint = /data retention mode/iu.test(core)
    ? ` See ${BEDROCK_DATA_RETENTION_DOCS_URL} for supported data retention modes.`
    : "";
  if (error instanceof BedrockRuntimeServiceException) {
    const prefix = BEDROCK_ERROR_PREFIXES[error.name] ?? error.name;
    return `${prefix}: ${core}${dataRetentionHint}`;
  }
  return `${core}${dataRetentionHint}`;
}

type SdkErrorMetadata = { $metadata?: { httpStatusCode?: unknown; requestId?: unknown } };

const MAX_BEDROCK_DIAGNOSTIC_VALUE_CHARS = 200;

function normalizeDiagnosticValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_BEDROCK_DIAGNOSTIC_VALUE_CHARS) return undefined;
  return trimmed;
}

function extractBedrockErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.name.endsWith("Exception")) return undefined;
  return normalizeDiagnosticValue(error.name);
}

function appendBedrockFailureDiagnostic(
  output: AssistantMessage,
  error: unknown,
  fallbackRequestId: string | undefined,
): void {
  const metadata = (error as SdkErrorMetadata)?.$metadata;
  const details: JsonObject = {};

  if (typeof metadata?.httpStatusCode === "number") details["status"] = metadata.httpStatusCode;

  const errorCode = extractBedrockErrorCode(error);
  if (errorCode !== undefined) details["errorCode"] = errorCode;

  const requestId = normalizeDiagnosticValue(metadata?.requestId) ?? fallbackRequestId;
  if (requestId !== undefined) details["requestId"] = requestId;

  if (Object.keys(details).length === 0) return;

  appendAssistantMessageDiagnostic(output, {
    type: "bedrock_response_failure",
    timestamp: Date.now(),
    details,
  });
}

const RESERVED_HEADER_EXACT = new Set(["authorization", "host"]);

function isReservedHeader(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("x-amz-") || RESERVED_HEADER_EXACT.has(lower);
}

function addCustomHeadersMiddleware(
  client: BedrockRuntimeClient,
  headers: Record<string, string>,
): void {
  const middleware: BuildMiddleware<object, MetadataBearer> = (next) => (args) => {
    const request = args.request;
    if (request && typeof request === "object" && "headers" in request) {
      const requestHeaders = (request as { headers: Record<string, string> }).headers;
      for (const [key, value] of Object.entries(headers)) {
        if (!isReservedHeader(key)) {
          requestHeaders[key] = value;
        }
      }
    }
    return next(args);
  };
  client.middlewareStack.add(middleware, {
    step: "build",
    name: "msa-ai-custom-headers",
    priority: "low",
  });
}

function isSmithyHttpResponse(response: unknown): response is HttpResponse {
  if (!response || typeof response !== "object") return false;
  const candidate = response as Partial<HttpResponse>;
  return (
    typeof candidate.statusCode === "number" &&
    candidate.headers !== undefined &&
    typeof candidate.headers === "object"
  );
}

function toProviderResponse(response: unknown): ProviderResponse | undefined {
  if (!isSmithyHttpResponse(response)) return undefined;
  return { status: response.statusCode, headers: { ...response.headers } };
}

function addResponseHeadersMiddleware(
  client: BedrockRuntimeClient,
  onResponse: NonNullable<BedrockOptions["onResponse"]>,
  model: Model<"bedrock-converse-stream">,
  onObserved: () => void,
): void {
  const middleware: DeserializeMiddleware<object, MetadataBearer> = (next) => async (args) => {
    const result = await next(args);
    const providerResponse = toProviderResponse(result.response);
    if (providerResponse !== undefined) {
      onObserved();
      await onResponse(providerResponse, model);
    }
    return result;
  };
  client.middlewareStack.add(middleware, { step: "deserialize", name: "msa-ai-response-headers" });
}

export const streamSimple: StreamFunction<"bedrock-converse-stream", SimpleStreamOptions> = (
  model: Model<"bedrock-converse-stream">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const base = {
    ...buildBaseOptions(model, context, options, undefined),
    toolChoice: options?.toolChoice,
  } satisfies BedrockOptions;
  if (options?.reasoning === undefined) {
    return stream(model, context, { ...base, reasoning: undefined } satisfies BedrockOptions);
  }

  if (isAnthropicClaudeModel(model)) {
    if (supportsAdaptiveThinking(model.id, model.name)) {
      return stream(model, context, {
        ...base,
        reasoning: options.reasoning,
        thinkingBudgets: options.thinkingBudgets,
      } satisfies BedrockOptions);
    }

    const adjusted = adjustMaxTokensForThinking(
      base.maxTokens,
      model.maxTokens,
      options.reasoning,
      options.thinkingBudgets,
    );

    const maxTokens = clampMaxTokensToContext(model, context, adjusted.maxTokens);

    return stream(model, context, {
      ...base,
      maxTokens,
      reasoning: options.reasoning,
      thinkingBudgets: {
        ...(options.thinkingBudgets || {}),
        [clampReasoning(options.reasoning)!]: Math.min(
          adjusted.thinkingBudget,
          Math.max(0, maxTokens - 1024),
        ),
      },
    } satisfies BedrockOptions);
  }

  return stream(model, context, {
    ...base,
    reasoning: options.reasoning,
    thinkingBudgets: options.thinkingBudgets,
  } satisfies BedrockOptions);
};

function handleContentBlockStart(
  event: ContentBlockStartEvent,
  blocks: Block[],
  output: AssistantMessage,
  events: AssistantMessageEventStream,
): void {
  const index = event.contentBlockIndex!;
  const start = event.start;

  if (start?.toolUse !== undefined) {
    const block: Block = {
      type: "toolCall",
      id: start.toolUse.toolUseId || "",
      name: start.toolUse.name || "",
      arguments: {},
      partialJson: "",
      index,
    };
    output.content.push(block);
    events.push({ type: "toolcall_start", contentIndex: blocks.length - 1, partial: output });
  }
}

function handleContentBlockDelta(
  event: ContentBlockDeltaEvent,
  blocks: Block[],
  output: AssistantMessage,
  events: AssistantMessageEventStream,
): void {
  const contentBlockIndex = event.contentBlockIndex!;
  const delta = event.delta;
  let index = blocks.findIndex((b) => b.index === contentBlockIndex);
  let block = blocks[index];

  if (delta?.text !== undefined) {
    if (block === undefined) {
      const newBlock: Block = { type: "text", text: "", index: contentBlockIndex };
      output.content.push(newBlock);
      index = blocks.length - 1;
      block = newBlock;
      events.push({ type: "text_start", contentIndex: index, partial: output });
    }
    if (block.type === "text") {
      block.text += delta.text;
      events.push({ type: "text_delta", contentIndex: index, delta: delta.text, partial: output });
    }
  } else if (delta?.toolUse !== undefined && block?.type === "toolCall") {
    block.partialJson = (block.partialJson || "") + (delta.toolUse.input || "");
    block.arguments = parseStreamingJson(block.partialJson);
    events.push({
      type: "toolcall_delta",
      contentIndex: index,
      delta: delta.toolUse.input || "",
      partial: output,
    });
  } else if (delta?.reasoningContent !== undefined) {
    let thinkingBlock = block;
    let thinkingIndex = index;

    if (thinkingBlock === undefined) {
      const newBlock: Block = {
        type: "thinking",
        thinking: "",
        thinkingSignature: "",
        index: contentBlockIndex,
      };
      output.content.push(newBlock);
      thinkingIndex = blocks.length - 1;
      thinkingBlock = blocks[thinkingIndex];
      events.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
    }

    if (thinkingBlock?.type === "thinking") {
      if (delta.reasoningContent.text !== undefined && delta.reasoningContent.text !== "") {
        thinkingBlock.thinking += delta.reasoningContent.text;
        events.push({
          type: "thinking_delta",
          contentIndex: thinkingIndex,
          delta: delta.reasoningContent.text,
          partial: output,
        });
      }
      if (
        delta.reasoningContent.signature !== undefined &&
        delta.reasoningContent.signature !== "" &&
        thinkingBlock.redacted !== true
      ) {
        thinkingBlock.thinkingSignature =
          (thinkingBlock.thinkingSignature || "") + delta.reasoningContent.signature;
      }
      if (
        delta.reasoningContent.redactedContent?.length !== undefined &&
        delta.reasoningContent.redactedContent?.length > 0
      ) {
        if (thinkingBlock.redacted !== true) {
          thinkingBlock.redacted = true;
          thinkingBlock.thinkingSignature = "";
          thinkingBlock.thinking += REDACTED_THINKING_PLACEHOLDER;
          events.push({
            type: "thinking_delta",
            contentIndex: thinkingIndex,
            delta: REDACTED_THINKING_PLACEHOLDER,
            partial: output,
          });
        }
        thinkingBlock.redactedChunks ??= [];
        thinkingBlock.redactedChunks.push(delta.reasoningContent.redactedContent);
      }
    }
  }
}

function flushRedactedContent(block: Block): void {
  if (block.type !== "thinking" || block.redactedChunks === undefined) return;
  block.thinkingSignature = bytesToBase64(block.redactedChunks);
  delete block.redactedChunks;
}

function finalizeStreamingBlock(block: Block): void {
  delete block.index;
  delete block.partialJson;
  flushRedactedContent(block);
}

function handleMetadata(
  event: ConverseStreamMetadataEvent,
  model: Model<"bedrock-converse-stream">,
  output: AssistantMessage,
): void {
  if (event.usage !== undefined) {
    output.usage.input = event.usage.inputTokens || 0;
    output.usage.output = event.usage.outputTokens || 0;
    output.usage.cacheRead = event.usage.cacheReadInputTokens || 0;
    output.usage.cacheWrite = event.usage.cacheWriteInputTokens || 0;
    output.usage.cacheWrite1h = event.usage.cacheDetails?.reduce(
      (total, detail) => total + (detail.ttl === CacheTTL.ONE_HOUR ? (detail.inputTokens ?? 0) : 0),
      0,
    );
    output.usage.totalTokens = event.usage.totalTokens || output.usage.input + output.usage.output;
    calculateCost(model, output.usage);
  }
}

function handleContentBlockStop(
  event: ContentBlockStopEvent,
  blocks: Block[],
  output: AssistantMessage,
  events: AssistantMessageEventStream,
): void {
  const index = blocks.findIndex((b) => b.index === event.contentBlockIndex);
  const block = blocks[index];
  if (block === undefined) return;
  delete (block as Block).index;

  switch (block.type) {
    case "text":
      events.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
      break;
    case "thinking":
      flushRedactedContent(block);
      events.push({
        type: "thinking_end",
        contentIndex: index,
        content: block.thinking,
        partial: output,
      });
      break;
    case "toolCall":
      Object.assign(block, parseToolCallArguments(block.partialJson));
      delete (block as Block).partialJson;
      events.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
      break;
  }
}

function getModelMatchCandidates(modelId: string, modelName?: string): string[] {
  const values = modelName !== undefined && modelName !== "" ? [modelId, modelName] : [modelId];
  return values.flatMap((value) => {
    const lower = value.toLowerCase();
    return [lower, lower.replace(/[\s_.:]+/gu, "-")];
  });
}

function supportsAdaptiveThinking(modelId: string, modelName?: string): boolean {
  const candidates = getModelMatchCandidates(modelId, modelName);
  return candidates.some(
    (s) =>
      s.includes("opus-4-6") ||
      s.includes("opus-4-7") ||
      s.includes("opus-4-8") ||
      s.includes("opus-5") ||
      s.includes("sonnet-4-6") ||
      s.includes("sonnet-5") ||
      s.includes("haiku-5") ||
      s.includes("fable-5"),
  );
}

function supportsNativeXhighEffort(model: Model<"bedrock-converse-stream">): boolean {
  const candidates = getModelMatchCandidates(model.id, model.name);
  return candidates.some(
    (s) =>
      s.includes("opus-4-7") ||
      s.includes("opus-4-8") ||
      s.includes("opus-5") ||
      s.includes("sonnet-5") ||
      s.includes("haiku-5") ||
      s.includes("fable-5"),
  );
}

function supportsThinkingBlockBinding(model: Model<"bedrock-converse-stream">): boolean {
  const candidates = getModelMatchCandidates(model.id, model.name);
  return candidates.some(
    (s) =>
      s.includes("opus-4-7") ||
      s.includes("opus-4-8") ||
      s.includes("opus-5") ||
      s.includes("sonnet-5") ||
      s.includes("haiku-5") ||
      s.includes("fable-5"),
  );
}

function mapThinkingLevelToEffort(
  model: Model<"bedrock-converse-stream">,
  level: SimpleStreamOptions["reasoning"],
): "low" | "medium" | "high" | "xhigh" | "max" {
  if (level === "xhigh" && supportsNativeXhighEffort(model)) return "xhigh";

  const mapped = level === undefined ? undefined : model.thinkingLevelMap?.[level];
  if (typeof mapped === "string") return mapped as "low" | "medium" | "high" | "xhigh" | "max";

  switch (level) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "high";
  }
}

function resolveCacheRetention(cacheRetention?: CacheRetention, env?: ProviderEnv): CacheRetention {
  if (cacheRetention !== undefined) {
    return cacheRetention;
  }
  if (getProviderEnvValue("MSA_CACHE_RETENTION", env) === "long") {
    return "long";
  }
  return "short";
}

function isAnthropicClaudeModel(model: Model<"bedrock-converse-stream">): boolean {
  const id = model.id.toLowerCase();
  const name = model.name?.toLowerCase() ?? "";
  return (
    id.includes("anthropic.claude") ||
    id.includes("anthropic/claude") ||
    name.includes("anthropic.claude") ||
    name.includes("anthropic/claude") ||
    name.includes("claude")
  );
}

function supportsPromptCaching(
  model: Model<"bedrock-converse-stream">,
  env?: ProviderEnv,
): boolean {
  const candidates = getModelMatchCandidates(model.id, model.name);

  const hasClaudeRef = candidates.some((s) => s.includes("claude"));
  if (!hasClaudeRef) {
    if (getProviderEnvValue("AWS_BEDROCK_FORCE_CACHE", env) === "1") return true;
    return false;
  }
  if (
    candidates.some(
      (s) =>
        s.includes("fable-5") ||
        s.includes("opus-5") ||
        s.includes("sonnet-5") ||
        s.includes("haiku-5"),
    )
  )
    return true;
  if (candidates.some((s) => s.includes("-4-"))) return true;
  if (candidates.some((s) => s.includes("claude-3-7-sonnet"))) return true;
  if (candidates.some((s) => s.includes("claude-3-5-haiku"))) return true;
  return false;
}

function supportsThinkingSignature(model: Model<"bedrock-converse-stream">): boolean {
  return isAnthropicClaudeModel(model);
}

function buildSystemPrompt(
  systemPrompt: string | undefined,
  model: Model<"bedrock-converse-stream">,
  cacheRetention: CacheRetention,
  env?: ProviderEnv,
): SystemContentBlock[] | undefined {
  if (systemPrompt === undefined || systemPrompt === "") return undefined;

  const blocks: SystemContentBlock[] = [{ text: sanitizeSurrogates(systemPrompt) }];

  if (cacheRetention !== "none" && supportsPromptCaching(model, env)) {
    blocks.push({
      cachePoint: {
        type: CachePointType.DEFAULT,
        ...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}),
      },
    });
  }

  return blocks;
}

function normalizeToolCallId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length));
  return sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
}

function createNonBlankTextBlock(text: string): ContentBlock.TextMember | undefined {
  const sanitized = sanitizeSurrogates(text);
  return sanitized.trim().length === 0 ? undefined : { text: sanitized };
}

function createRequiredTextBlock(text: string): ContentBlock.TextMember {
  return createNonBlankTextBlock(text) ?? { text: EMPTY_TEXT_PLACEHOLDER };
}

function sanitizeBedrockDocument(value: JsonValue): DocumentType {
  if (Array.isArray(value)) {
    return value.map(sanitizeBedrockDocument);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key.length > 0)
        .map(([key, nestedValue]) => [key, sanitizeBedrockDocument(nestedValue)]),
    );
  }
  return value;
}

function convertToolResultContent(
  content: (TextContent | ImageContent)[],
): ToolResultContentBlock[] {
  const result: ToolResultContentBlock[] = [];
  for (const c of content) {
    if (c.type === "image") {
      result.push({ image: createImageBlock(c.mimeType, c.data) });
    } else {
      const textBlock = createNonBlankTextBlock(c.text);
      if (textBlock !== undefined) result.push(textBlock);
    }
  }
  if (result.length === 0) result.push({ text: EMPTY_TEXT_PLACEHOLDER });
  return result;
}

function convertMessages(
  context: TranscriptContext,
  model: Model<"bedrock-converse-stream">,
  cacheRetention: CacheRetention,
  env?: ProviderEnv,
): Message[] {
  const result: Message[] = [];
  const transformedMessages = transformMessages(
    withoutInitialSystemMessage(context.messages),
    model,
    normalizeToolCallId,
  );

  for (let i = 0; i < transformedMessages.length; i++) {
    const m = transformedMessages[i];
    if (m === undefined) continue;

    switch (m.role) {
      case "user": {
        const content: ContentBlock[] = [];
        if (typeof m.content === "string") {
          content.push(createRequiredTextBlock(m.content));
        } else {
          for (const c of m.content) {
            switch (c.type) {
              case "text": {
                const textBlock = createNonBlankTextBlock(c.text);
                if (textBlock !== undefined) content.push(textBlock);
                break;
              }
              case "image":
                content.push({ image: createImageBlock(c.mimeType, c.data) });
                break;
              default:
                continue;
            }
          }
          if (content.length === 0) content.push({ text: EMPTY_TEXT_PLACEHOLDER });
        }
        result.push({ role: ConversationRole.USER, content });
        break;
      }
      case "assistant": {
        if (m.content.length === 0) {
          continue;
        }
        const contentBlocks: ContentBlock[] = [];
        for (const c of m.content) {
          switch (c.type) {
            case "text": {
              const textBlock = createNonBlankTextBlock(c.text);
              if (textBlock === undefined) continue;
              contentBlocks.push(textBlock);
              break;
            }
            case "toolCall":
              contentBlocks.push({
                toolUse: {
                  toolUseId: c.id,
                  name: c.name,
                  input: sanitizeBedrockDocument(c.arguments),
                },
              });
              break;
            case "thinking": {
              if (c.redacted === true) {
                const redactedContent = decodeRedactedContent(c.thinkingSignature);
                if (redactedContent?.length !== undefined && redactedContent?.length > 0) {
                  contentBlocks.push({ reasoningContent: { redactedContent } });
                }
                continue;
              }
              const thinking = sanitizeSurrogates(c.thinking);
              if (thinking.trim().length === 0) continue;
              if (supportsThinkingSignature(model)) {
                if (
                  c.thinkingSignature === undefined ||
                  c.thinkingSignature === "" ||
                  c.thinkingSignature.trim().length === 0
                ) {
                  contentBlocks.push({ text: thinking });
                } else {
                  contentBlocks.push({
                    reasoningContent: {
                      reasoningText: {
                        text: thinking,
                        signature: c.thinkingSignature,
                      },
                    },
                  });
                }
              } else {
                contentBlocks.push({
                  reasoningContent: {
                    reasoningText: { text: thinking },
                  },
                });
              }
              break;
            }
            default:
              continue;
          }
        }
        if (contentBlocks.length === 0) {
          continue;
        }
        result.push({
          role: ConversationRole.ASSISTANT,
          content: contentBlocks,
        });
        break;
      }
      case "toolResult": {
        const toolResults: ContentBlock.ToolResultMember[] = [];

        toolResults.push({
          toolResult: {
            toolUseId: m.toolCallId,
            content: convertToolResultContent(m.content),
            status: m.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
          },
        });

        let j = i + 1;
        let nextMsg = transformedMessages[j];
        while (nextMsg?.role === "toolResult") {
          toolResults.push({
            toolResult: {
              toolUseId: nextMsg.toolCallId,
              content: convertToolResultContent(nextMsg.content),
              status: nextMsg.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
            },
          });
          nextMsg = transformedMessages[++j];
        }

        i = j - 1;

        result.push({ role: ConversationRole.USER, content: toolResults });
        break;
      }
      default:
        continue;
    }
  }

  if (cacheRetention !== "none" && supportsPromptCaching(model, env) && result.length > 0) {
    const lastMessage = result.at(-1);
    if (lastMessage?.role === ConversationRole.USER && lastMessage.content !== undefined) {
      (lastMessage.content as ContentBlock[]).push({
        cachePoint: {
          type: CachePointType.DEFAULT,
          ...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}),
        },
      });
    }
  }

  return result;
}

function convertToolConfig(
  tools: Tool[] | undefined,
  toolChoice: BedrockOptions["toolChoice"],
  supportsStrictMode: boolean,
): ToolConfiguration | undefined {
  if (tools?.length === undefined || tools?.length === 0) return undefined;
  if (toolChoice === "none") return undefined;

  const bedrockTools: BedrockTool[] = tools.map((tool) => {
    const strict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
    return {
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: { json: getJsonSchemaToolParameters(tool, strict) as unknown as DocumentType },
        ...(strict === true ? { strict: true } : {}),
      },
    };
  });

  let bedrockToolChoice: ToolChoice | undefined;
  switch (toolChoice) {
    case "auto":
      bedrockToolChoice = { auto: {} };
      break;
    case "any":
      bedrockToolChoice = { any: {} };
      break;
    default:
      if (toolChoice?.type === "tool") {
        bedrockToolChoice = { tool: { name: toolChoice.name } };
      }
  }

  return { tools: bedrockTools, toolChoice: bedrockToolChoice };
}

function mapStopReason(reason: string | undefined): {
  stopReason: StopReason;
  errorMessage?: string;
} {
  switch (reason) {
    case BedrockStopReason.END_TURN:
    case BedrockStopReason.STOP_SEQUENCE:
      return { stopReason: "stop" };
    case BedrockStopReason.MAX_TOKENS:
    case BedrockStopReason.MODEL_CONTEXT_WINDOW_EXCEEDED:
      return { stopReason: "length" };
    case BedrockStopReason.TOOL_USE:
      return { stopReason: "toolUse" };
    default:
      return reason !== undefined && reason !== ""
        ? { stopReason: "error", errorMessage: `Provider stopped with: ${reason}` }
        : { stopReason: "error" };
  }
}

function getConfiguredBedrockRegion(options: BedrockOptions): string | undefined {
  return (
    options.region ||
    getProviderEnvValue("AWS_REGION", options.env) ||
    getProviderEnvValue("AWS_DEFAULT_REGION", options.env) ||
    undefined
  );
}

function getConfiguredBedrockCredentials(
  env?: ProviderEnv,
): BedrockRuntimeClientConfig["credentials"] | undefined {
  const accessKeyId = getProviderEnvValue("AWS_ACCESS_KEY_ID", env);
  const secretAccessKey = getProviderEnvValue("AWS_SECRET_ACCESS_KEY", env);
  if (
    accessKeyId === undefined ||
    accessKeyId === "" ||
    secretAccessKey === undefined ||
    secretAccessKey === ""
  ) {
    return undefined;
  }
  const sessionToken = getProviderEnvValue("AWS_SESSION_TOKEN", env);
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken !== undefined && sessionToken !== "" ? { sessionToken } : {}),
  };
}

function getStandardBedrockEndpointRegion(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined || baseUrl === "") {
    return undefined;
  }

  try {
    const { hostname } = new URL(baseUrl);
    const match = hostname
      .toLowerCase()
      .match(/^bedrock-runtime(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/u);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function shouldUseExplicitBedrockEndpoint(
  baseUrl: string,
  configuredRegion: string | undefined,
  hasAmbientConfiguredProfile: boolean,
): boolean {
  const endpointRegion = getStandardBedrockEndpointRegion(baseUrl);
  if (endpointRegion === undefined || endpointRegion === "") {
    return true;
  }

  return (
    (configuredRegion === undefined || configuredRegion === "") && !hasAmbientConfiguredProfile
  );
}

function isGovCloudBedrockTarget(
  model: Model<"bedrock-converse-stream">,
  options: BedrockOptions,
): boolean {
  const region = getConfiguredBedrockRegion(options);
  if (region?.toLowerCase().startsWith("us-gov-") === true) {
    return true;
  }

  const modelId = model.id.toLowerCase();
  return modelId.startsWith("us-gov.") || modelId.startsWith("arn:aws-us-gov:");
}

function buildAdditionalModelRequestFields(
  model: Model<"bedrock-converse-stream">,
  options: BedrockOptions,
): Record<string, any> | undefined {
  if (options.reasoning === undefined || !model.reasoning) {
    return undefined;
  }

  if (isAnthropicClaudeModel(model)) {
    const isGovCloud = isGovCloudBedrockTarget(model, options);
    const display = isGovCloud ? undefined : (options.thinkingDisplay ?? "summarized");
    const useBlockBinding = !isGovCloud && supportsThinkingBlockBinding(model);
    const result: Record<string, any> = supportsAdaptiveThinking(model.id, model.name)
      ? {
          thinking: {
            type: "adaptive",
            ...(display === undefined ? {} : { display }),
            ...(useBlockBinding
              ? { block_binding: { prefix_mismatch_behavior: "drop_block" } }
              : {}),
          },
          output_config: { effort: mapThinkingLevelToEffort(model, options.reasoning) },
          ...(useBlockBinding ? { anthropic_beta: [THINKING_BINDING_CONTROLS_BETA] } : {}),
        }
      : (() => {
          const defaultBudgets: Record<ThinkingLevel, number> = {
            minimal: 1024,
            low: 2048,
            medium: 8192,
            high: 16384,
            xhigh: 16384,
            max: 16384,
          };

          const level =
            options.reasoning === "xhigh" || options.reasoning === "max"
              ? "high"
              : options.reasoning;
          const budget = options.thinkingBudgets?.[level] ?? defaultBudgets[options.reasoning];

          return {
            thinking: {
              type: "enabled",
              budget_tokens: budget,
              ...(display === undefined ? {} : { display }),
            },
          };
        })();

    if (!supportsAdaptiveThinking(model.id, model.name) && (options.interleavedThinking ?? true)) {
      result["anthropic_beta"] = ["interleaved-thinking-2025-05-14"];
    }

    return result;
  }

  const candidates = getModelMatchCandidates(model.id, model.name);

  if (candidates.some((s) => s.includes("gpt-oss"))) {
    return { reasoning_effort: OPENAI_GPT_OSS_EFFORT[options.reasoning] };
  }

  if (candidates.some((s) => s.includes("gpt-"))) {
    const mapped = model.thinkingLevelMap?.[options.reasoning];
    return {
      reasoning: {
        effort: typeof mapped === "string" ? mapped : OPENAI_GPT_EFFORT[options.reasoning],
      },
    };
  }

  return undefined;
}

type OpenAIGptEffort = "low" | "medium" | "high" | "xhigh" | "max";
type OpenAIGptOssEffort = "low" | "medium" | "high";

const OPENAI_GPT_EFFORT: Record<ThinkingLevel, OpenAIGptEffort> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

const OPENAI_GPT_OSS_EFFORT: Record<ThinkingLevel, OpenAIGptOssEffort> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

function createImageBlock(mimeType: string, data: string) {
  let format: ImageFormat;
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      format = ImageFormat.JPEG;
      break;
    case "image/png":
      format = ImageFormat.PNG;
      break;
    case "image/gif":
      format = ImageFormat.GIF;
      break;
    case "image/webp":
      format = ImageFormat.WEBP;
      break;
    default:
      throw new Error(`Unknown image type: ${mimeType}`);
  }

  return { source: { bytes: base64ToBytes(data) }, format };
}

function base64ToBytes(data: string): Uint8Array {
  const binaryString = atob(data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function decodeRedactedContent(signature: string | undefined): Uint8Array | undefined {
  if (signature === undefined || signature === "") return undefined;
  try {
    return base64ToBytes(signature);
  } catch {
    return undefined;
  }
}

function bytesToBase64(chunks: Uint8Array[]): string {
  const WINDOW = 0x8000;
  let binary = "";
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += WINDOW) {
      binary += String.fromCharCode(...chunk.subarray(i, i + WINDOW));
    }
  }
  return btoa(binary);
}
