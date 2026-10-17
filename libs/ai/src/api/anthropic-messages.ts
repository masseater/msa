import Anthropic, { APIError, type ClientOptions } from "@anthropic-ai/sdk";
import type {
  BetaInputTransformation,
  BetaStopReason,
  BetaTool,
  BetaCacheControlEphemeral as CacheControlEphemeral,
  BetaContentBlockParam as ContentBlockParam,
  MessageCreateParamsStreaming,
  BetaMessageParam as MessageParam,
  BetaRawMessageStreamEvent as RawMessageStreamEvent,
  BetaRefusalStopDetails as RefusalStopDetails,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import {
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
  ANTHROPIC_SERVICE_ACCOUNT_ID_ENV,
  ANTHROPIC_WORKSPACE_ID_ENV,
} from "../env-api-keys.ts";
import { calculateCost } from "../models.ts";
import type {
  Api,
  AssistantMessage,
  CacheRetention,
  ImageContent,
  Message,
  Model,
  ProviderEnv,
  ProviderHeaders,
  SimpleStreamOptions,
  StopReason,
  StreamFunction,
  StreamOptions,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolResultMessage,
} from "../types.ts";
import { appendAssistantMessageDiagnostic } from "../utils/diagnostics.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import {
  parseJsonWithRepair,
  parseStreamingJson,
  parseToolCallArguments,
} from "../utils/json-parse.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { retryProviderRequest } from "../utils/provider-retry.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getSystemMessageText, renderSystemMessageUpdate } from "../utils/text.ts";
import {
  getCurrentTools,
  getInitialSystemMessage,
  resolveTranscript,
  type TranscriptContext,
} from "../utils/transcript.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import {
  getJsonSchemaToolParameters,
  resolveJsonSchemaStrictSampling,
  type UnsupportedStrictSchemaKeywordCheck,
} from "./constrained-sampling.ts";
import {
  adjustMaxTokensForThinking,
  buildBaseOptions,
  clampMaxTokensToContext,
} from "./simple-options.ts";
import { transformMessages } from "./transform-messages.ts";

function resolveCacheRetention(cacheRetention?: CacheRetention, env?: ProviderEnv): CacheRetention {
  if (cacheRetention !== undefined) {
    return cacheRetention;
  }
  if (getProviderEnvValue("MSA_CACHE_RETENTION", env) === "long") {
    return "long";
  }
  return "short";
}

function getCacheControl(
  model: Model<"anthropic-messages">,
  cacheRetention?: CacheRetention,
  env?: ProviderEnv,
): { retention: CacheRetention; cacheControl?: CacheControlEphemeral } {
  const retention = resolveCacheRetention(cacheRetention, env);
  if (retention === "none") {
    return { retention };
  }
  const ttl =
    retention === "long" && getAnthropicCompat(model).supportsLongCacheRetention ? "1h" : undefined;
  return {
    retention,
    cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
  };
}

const claudeCodeVersion = "2.1.280";

const claudeCodeTools = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "KillShell",
  "NotebookEdit",
  "Skill",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
];

const ccToolLookup = new Map(claudeCodeTools.map((t) => [t.toLowerCase(), t]));

const toClaudeCodeName = (name: string) => ccToolLookup.get(name.toLowerCase()) ?? name;
const fromClaudeCodeName = (name: string, tools?: Tool[]) => {
  if (tools !== undefined && tools.length > 0) {
    const lowerName = name.toLowerCase();
    const matchedTool = tools.find((tool) => tool.name.toLowerCase() === lowerName);
    if (matchedTool !== undefined) return matchedTool.name;
  }
  return name;
};

function convertContentBlocks(content: (TextContent | ImageContent)[]):
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: {
            type: "base64";
            media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
            data: string;
          };
        }
    > {
  const hasImages = content.some((c) => c.type === "image");
  if (!hasImages) {
    return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
  }

  const blocks = content.map((block) => {
    if (block.type === "text") {
      return {
        type: "text" as const,
        text: sanitizeSurrogates(block.text),
      };
    }
    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: block.data,
      },
    };
  });

  const hasText = blocks.some((b) => b.type === "text");
  if (!hasText) {
    blocks.unshift({
      type: "text" as const,
      text: "(see attached image)",
    });
  }

  return blocks;
}

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type AnthropicThinkingDisplay = "summarized" | "omitted";

const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MID_CONVERSATION_OUTPUT_CONFIG_BETA = "mid-conversation-output-config-2026-07-01";
const THINKING_BINDING_CONTROLS_BETA = "thinking-binding-controls-2026-08-01";
const INLINE_TOOLS_BETA = "inline-tools-2026-09-15";

const DEFERRED_TOOL_PLACEHOLDER: BetaTool = {
  name: "__pi_deferred_placeholder__",
  description: "Reserved placeholder. Never available. Never call this.",
  input_schema: { type: "object", properties: {}, required: [] },
  defer_loading: true,
};

function shouldUseServerSideFallbackBeta(model: Model<"anthropic-messages">): boolean {
  return (model.compat?.allowedFallbackModels?.length ?? 0) > 0;
}

function getAnthropicCompat(model: Model<"anthropic-messages">) {
  const isOpenRouter = model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai");
  return {
    supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? true,
    supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
    sendSessionAffinityHeaders: model.compat?.sendSessionAffinityHeaders ?? isOpenRouter,
    sessionAffinityFormat:
      model.compat?.sessionAffinityFormat ?? (isOpenRouter ? "openrouter" : undefined),
    supportsCacheControlOnTools: model.compat?.supportsCacheControlOnTools ?? true,
    supportsTemperature: model.compat?.supportsTemperature ?? true,
    allowEmptySignature: model.compat?.allowEmptySignature ?? false,
    supportsStrictTools: model.compat?.supportsStrictTools ?? false,
    supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
    supportsMidConvoToolChanges: model.compat?.supportsMidConvoToolChanges ?? false,
  };
}

export interface AnthropicOptions extends StreamOptions {
  thinkingEnabled?: boolean | undefined;
  thinkingBudgetTokens?: number | undefined;
  effort?: AnthropicEffort | undefined;
  thinkingDisplay?: AnthropicThinkingDisplay | undefined;
  interleavedThinking?: boolean | undefined;
  toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string } | undefined;
  client?: Anthropic | undefined;
}

function mergeHeaders(...headerSources: (ProviderHeaders | undefined)[]): ProviderHeaders {
  const merged: ProviderHeaders = {};
  for (const headers of headerSources) {
    if (headers !== undefined) {
      Object.assign(merged, headers);
    }
  }
  return merged;
}

function mergeClientHeaders(...headerSources: (ProviderHeaders | undefined)[]): ProviderHeaders {
  return mergeHeaders({ "User-Agent": getMsaUserAgent() }, ...headerSources);
}

function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
  if (headers === undefined) return false;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected && value !== null && value.trim().length > 0) return true;
  }
  return false;
}

function hasRequestAuth(apiKey: string | undefined, headers: ProviderHeaders | undefined): boolean {
  return (
    (apiKey !== undefined && apiKey !== "") ||
    hasHeader(headers, "authorization") ||
    hasHeader(headers, "x-api-key") ||
    hasHeader(headers, "cf-aig-authorization")
  );
}

function assertRequestAuth(
  provider: string,
  apiKey: string | undefined,
  headers: ProviderHeaders | undefined,
): void {
  if (!hasRequestAuth(apiKey, headers)) throw new Error(`No API key for provider: ${provider}`);
}

class MsaAnthropic extends Anthropic {
  protected override _shouldResolveDefaultCredentials(): boolean {
    return false;
  }
}

type AnthropicFederationConfig = NonNullable<ClientOptions["config"]>;

function getAnthropicFederation(
  model: Model<"anthropic-messages">,
  apiKey: string | undefined,
  headers: ProviderHeaders | undefined,
  env: ProviderEnv | undefined,
): AnthropicFederationConfig | undefined {
  if (model.provider !== "anthropic" || hasRequestAuth(apiKey, headers)) return undefined;
  const federationRuleId = getProviderEnvValue(ANTHROPIC_FEDERATION_RULE_ID_ENV, env);
  const organizationId = getProviderEnvValue(ANTHROPIC_ORGANIZATION_ID_ENV, env);
  const identityTokenFile = getProviderEnvValue(ANTHROPIC_IDENTITY_TOKEN_FILE_ENV, env);
  if (
    federationRuleId === undefined ||
    federationRuleId === "" ||
    organizationId === undefined ||
    organizationId === "" ||
    identityTokenFile === undefined ||
    identityTokenFile === ""
  )
    return undefined;
  return {
    organization_id: organizationId,
    workspace_id: getProviderEnvValue(ANTHROPIC_WORKSPACE_ID_ENV, env),
    authentication: {
      type: "oidc_federation",
      federation_rule_id: federationRuleId,
      service_account_id: getProviderEnvValue(ANTHROPIC_SERVICE_ACCOUNT_ID_ENV, env),
      identity_token: { source: "file", path: identityTokenFile },
    },
  };
}

let federationClient:
  | { key: string; fetch: typeof globalThis.fetch | undefined; client: Anthropic }
  | undefined;

interface ServerSentEvent {
  event: string | null;
  data: string;
  raw: string[];
}

interface SseDecoderState {
  event: string | null;
  data: string[];
  raw: string[];
}

const ANTHROPIC_MESSAGE_EVENTS: ReadonlySet<string> = new Set([
  "message_start",
  "message_delta",
  "message_stop",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
]);

function flushSseEvent(state: SseDecoderState): ServerSentEvent | null {
  if ((state.event === null || state.event === "") && state.data.length === 0) {
    return null;
  }

  const event: ServerSentEvent = {
    event: state.event,
    data: state.data.join("\n"),
    raw: [...state.raw],
  };
  state.event = null;
  state.data = [];
  state.raw = [];
  return event;
}

function decodeSseLine(line: string, state: SseDecoderState): ServerSentEvent | null {
  if (line === "") {
    return flushSseEvent(state);
  }

  state.raw.push(line);
  if (line.startsWith(":")) {
    return null;
  }

  const delimiterIndex = line.indexOf(":");
  const fieldName = delimiterIndex === -1 ? line : line.slice(0, delimiterIndex);
  let value = delimiterIndex === -1 ? "" : line.slice(delimiterIndex + 1);
  if (value.startsWith(" ")) {
    value = value.slice(1);
  }

  if (fieldName === "event") {
    state.event = value;
  } else if (fieldName === "data") {
    state.data.push(value);
  }

  return null;
}

function nextLineBreakIndex(text: string): number {
  const carriageReturnIndex = text.indexOf("\r");
  const newlineIndex = text.indexOf("\n");
  if (carriageReturnIndex === -1) {
    return newlineIndex;
  }
  if (newlineIndex === -1) {
    return carriageReturnIndex;
  }
  return Math.min(carriageReturnIndex, newlineIndex);
}

function consumeLine(text: string): { line: string; rest: string } | null {
  const lineBreakIndex = nextLineBreakIndex(text);
  if (lineBreakIndex === -1) {
    return null;
  }

  let nextIndex = lineBreakIndex + 1;
  if (text[lineBreakIndex] === "\r" && text[nextIndex] === "\n") {
    nextIndex += 1;
  }

  return {
    line: text.slice(0, lineBreakIndex),
    rest: text.slice(nextIndex),
  };
}

async function* iterateSseMessages(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state: SseDecoderState = { event: null, data: [], raw: [] };
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted === true) {
        throw new Error("Request was aborted");
      }

      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let consumed = consumeLine(buffer);
      while (consumed !== null) {
        buffer = consumed.rest;
        const event = decodeSseLine(consumed.line, state);
        if (event !== null) {
          yield event;
        }
        consumed = consumeLine(buffer);
      }
    }

    buffer += decoder.decode();
    let consumed = consumeLine(buffer);
    while (consumed !== null) {
      buffer = consumed.rest;
      const event = decodeSseLine(consumed.line, state);
      if (event !== null) {
        yield event;
      }
      consumed = consumeLine(buffer);
    }

    if (buffer.length > 0) {
      const event = decodeSseLine(buffer, state);
      if (event !== null) {
        yield event;
      }
    }

    const trailingEvent = flushSseEvent(state);
    if (trailingEvent !== null) {
      yield trailingEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* iterateAnthropicEvents(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<RawMessageStreamEvent> {
  if (response.body === null) {
    throw new Error("Attempted to iterate over an Anthropic response with no body");
  }

  let sawMessageStart = false;
  let sawMessageEnd = false;

  for await (const sse of iterateSseMessages(response.body, signal)) {
    if (sse.event === "error") {
      throw new Error(sse.data);
    }

    if (!ANTHROPIC_MESSAGE_EVENTS.has(sse.event ?? "")) {
      continue;
    }

    try {
      const event = parseJsonWithRepair<RawMessageStreamEvent>(sse.data);
      if (event.type === "message_start") {
        sawMessageStart = true;
      } else if (event.type === "message_stop") {
        sawMessageEnd = true;
      }
      yield event;
    } catch (error) {
      const message = toErrorMessage(error);
      throw new Error(
        `Could not parse Anthropic SSE event ${sse.event}: ${message}; data=${sse.data}; raw=${sse.raw.join("\\n")}`,
        { cause: error },
      );
    }
  }

  if (sawMessageStart && !sawMessageEnd) {
    throw new Error("Anthropic stream ended before message_stop");
  }
}

export const stream: StreamFunction<"anthropic-messages", AnthropicOptions> = (
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  options?: AnthropicOptions,
): AssistantMessageEventStream => {
  const events = new AssistantMessageEventStream();
  const normalizedContext = resolveTranscript(
    context,
    getAnthropicCompat(model).supportsMidConvoSystemMessages,
  );
  const currentTools = getCurrentTools(normalizedContext.messages);

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api as Api,
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

    try {
      let client: Anthropic;
      let isOAuth: boolean;
      let usageModel = model;
      let inputTransformations: BetaInputTransformation[] | undefined;

      if (options?.client === undefined) {
        const apiKey = options?.apiKey;
        const federation = getAnthropicFederation(model, apiKey, options?.headers, options?.env);
        if (federation === undefined) assertRequestAuth(model.provider, apiKey, options?.headers);

        const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
        const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;

        const created = createClient(
          model,
          apiKey,
          options?.headers,
          options?.fetch,
          cacheSessionId,
          federation,
        );
        client = created.client;
        isOAuth = created.isOAuthToken;
      } else {
        client = options.client;
        isOAuth = false;
      }
      const requestOptions = {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
        maxRetries: 0,
      };
      let disablePreferredStrictTools = false;
      let response: Response;
      for (;;) {
        options?.signal?.throwIfAborted();
        const built = buildParams(
          model,
          normalizedContext,
          isOAuth,
          options,
          disablePreferredStrictTools,
        );
        if (built.providerThinkingLevel !== undefined)
          output.providerThinkingLevel = built.providerThinkingLevel;
        let params = built.params;
        const nextParams = await options?.onPayload?.(params, model);
        if (nextParams !== undefined) {
          params = { ...(nextParams as MessageCreateParamsStreaming), stream: true };
        }
        try {
          response = await retryProviderRequest(
            () => client.beta.messages.create(params, requestOptions).asResponse(),
            {
              maxRetries: options?.maxRetries,
              maxRetryDelayMs: options?.maxRetryDelayMs,
              signal: options?.signal,
            },
          );
          break;
        } catch (error) {
          if (
            options?.signal?.aborted === true ||
            disablePreferredStrictTools ||
            !built.hasPreferredStrictTools ||
            !(error instanceof APIError) ||
            error.status !== 400 ||
            error.type !== "invalid_request_error" ||
            ![
              "The compiled grammar is too large",
              "Too many strict tools (",
              "Schemas contains too many parameters with union types (",
            ].some((message) => error.message.includes(message))
          ) {
            throw error;
          }
          disablePreferredStrictTools = true;
          appendAssistantMessageDiagnostic(output, {
            type: "anthropic_strict_tools_fallback",
            timestamp: Date.now(),
            error: { message: error.message },
            details: { reason: "strict_tool_limits_exceeded" },
          });
        }
      }
      await options?.onResponse?.(
        { status: response.status, headers: headersToRecord(response.headers) },
        model,
      );
      events.push({ type: "start", partial: output });

      type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & {
        index: number;
      };
      const blocks = output.content as Block[];

      for await (const event of iterateAnthropicEvents(response, options?.signal)) {
        await options?.onProviderStreamEvent?.(event, model);
        if (event.type === "message_start") {
          output.responseId = event.message.id;
          const transformations = event.message.input_transformations;
          if (Array.isArray(transformations)) inputTransformations = transformations;
          const responseModel = event.message.model;
          if (responseModel !== model.id) output.responseModel = responseModel;
          const fallbackCost =
            responseModel === model.id
              ? undefined
              : model.compat?.allowedFallbackModels?.find(
                  (fallback) =>
                    fallback.provider === model.provider && fallback.model === responseModel,
                )?.cost;
          usageModel =
            fallbackCost === undefined
              ? model
              : { ...model, id: responseModel, cost: fallbackCost };
          output.usage.input = event.message.usage.input_tokens || 0;
          output.usage.output = event.message.usage.output_tokens || 0;
          output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
          output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
          output.usage.cacheWrite1h =
            event.message.usage.cache_creation?.ephemeral_1h_input_tokens || 0;
          output.usage.totalTokens =
            output.usage.input +
            output.usage.output +
            output.usage.cacheRead +
            output.usage.cacheWrite;
          calculateCost(usageModel, output.usage);
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "fallback") {
            if (output.content.length > 0) {
              throw new Error("Anthropic performed an unsupported mid-output model fallback");
            }
            continue;
          }
          if (event.content_block.type === "text") {
            const block: Block = {
              type: "text",
              text: event.content_block.text ?? "",
              index: event.index,
            };
            output.content.push(block);
            events.push({
              type: "text_start",
              contentIndex: output.content.length - 1,
              partial: output,
            });
          } else if (event.content_block.type === "thinking") {
            const block: Block = {
              type: "thinking",
              thinking: event.content_block.thinking ?? "",
              thinkingSignature: event.content_block.signature ?? "",
              index: event.index,
            };
            output.content.push(block);
            events.push({
              type: "thinking_start",
              contentIndex: output.content.length - 1,
              partial: output,
            });
          } else if (event.content_block.type === "redacted_thinking") {
            const block: Block = {
              type: "thinking",
              thinking: "[Reasoning redacted]",
              thinkingSignature: event.content_block.data,
              redacted: true,
              index: event.index,
            };
            output.content.push(block);
            events.push({
              type: "thinking_start",
              contentIndex: output.content.length - 1,
              partial: output,
            });
          } else if (event.content_block.type === "tool_use") {
            const block: Block = {
              type: "toolCall",
              id: event.content_block.id,
              name: isOAuth
                ? fromClaudeCodeName(event.content_block.name, currentTools)
                : event.content_block.name,
              arguments: (event.content_block.input as Record<string, any>) ?? {},
              partialJson: "",
              index: event.index,
            };
            output.content.push(block);
            events.push({
              type: "toolcall_start",
              contentIndex: output.content.length - 1,
              partial: output,
            });
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block !== undefined && block.type === "text") {
              block.text += event.delta.text;
              events.push({
                type: "text_delta",
                contentIndex: index,
                delta: event.delta.text,
                partial: output,
              });
            }
          } else if (event.delta.type === "thinking_delta") {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block !== undefined && block.type === "thinking") {
              block.thinking += event.delta.thinking;
              events.push({
                type: "thinking_delta",
                contentIndex: index,
                delta: event.delta.thinking,
                partial: output,
              });
            }
          } else if (event.delta.type === "input_json_delta") {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block !== undefined && block.type === "toolCall") {
              block.partialJson += event.delta.partial_json;
              block.arguments = parseStreamingJson(block.partialJson);
              events.push({
                type: "toolcall_delta",
                contentIndex: index,
                delta: event.delta.partial_json,
                partial: output,
              });
            }
          } else if (event.delta.type === "signature_delta") {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block !== undefined && block.type === "thinking") {
              block.thinkingSignature = block.thinkingSignature || "";
              block.thinkingSignature += event.delta.signature;
            }
          }
        } else if (event.type === "content_block_stop") {
          const index = blocks.findIndex((b) => b.index === event.index);
          const block = blocks[index];
          if (block !== undefined) {
            delete (block as any).index;
            if (block.type === "text") {
              events.push({
                type: "text_end",
                contentIndex: index,
                content: block.text,
                partial: output,
              });
            } else if (block.type === "thinking") {
              events.push({
                type: "thinking_end",
                contentIndex: index,
                content: block.thinking,
                partial: output,
              });
            } else if (block.type === "toolCall") {
              Object.assign(block, parseToolCallArguments(block.partialJson));
              delete (block as { partialJson?: string }).partialJson;
              events.push({
                type: "toolcall_end",
                contentIndex: index,
                toolCall: block,
                partial: output,
              });
            }
          }
        } else if (event.type === "message_delta") {
          const transformations = event.input_transformations;
          if (Array.isArray(transformations)) inputTransformations = transformations;
          if (event.delta.stop_reason !== null) {
            output.rawStopReason = event.delta.stop_reason;
            const stopReasonResult = mapStopReason(
              event.delta.stop_reason,
              event.delta.stop_details,
            );
            output.stopReason = stopReasonResult.stopReason;
            if (
              stopReasonResult.errorMessage !== undefined &&
              stopReasonResult.errorMessage !== ""
            ) {
              output.errorMessage = stopReasonResult.errorMessage;
            }
          }
          if (event.usage) {
            if (event.usage.input_tokens !== undefined && event.usage.input_tokens !== null) {
              output.usage.input = event.usage.input_tokens;
            }
            if (event.usage.output_tokens !== undefined && event.usage.output_tokens !== null) {
              output.usage.output = event.usage.output_tokens;
            }
            if (
              event.usage.cache_read_input_tokens !== undefined &&
              event.usage.cache_read_input_tokens !== null
            ) {
              output.usage.cacheRead = event.usage.cache_read_input_tokens;
            }
            if (
              event.usage.cache_creation_input_tokens !== undefined &&
              event.usage.cache_creation_input_tokens !== null
            ) {
              output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
            }
            const cacheCreation = (
              event.usage as typeof event.usage & {
                cache_creation?: { ephemeral_1h_input_tokens?: number };
              }
            ).cache_creation;
            if (
              cacheCreation?.ephemeral_1h_input_tokens !== undefined &&
              cacheCreation?.ephemeral_1h_input_tokens !== null
            ) {
              output.usage.cacheWrite1h = cacheCreation.ephemeral_1h_input_tokens;
            }
            const thinkingTokens = event.usage.output_tokens_details?.thinking_tokens;
            if (thinkingTokens !== undefined && thinkingTokens !== null) {
              output.usage.reasoning = thinkingTokens;
            }
          }
          output.usage.totalTokens =
            output.usage.input +
            output.usage.output +
            output.usage.cacheRead +
            output.usage.cacheWrite;
          calculateCost(usageModel, output.usage);
        }
      }

      if (options?.signal?.aborted === true) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "pending") {
        throw new Error("Anthropic stream ended without a stop reason");
      }
      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error(output.errorMessage || "An unknown error occurred");
      }
      if (inputTransformations !== undefined && inputTransformations.length > 0) {
        appendAssistantMessageDiagnostic(output, {
          type: "anthropic_input_transformations",
          timestamp: Date.now(),
          details: {
            transformations: inputTransformations.map((transformation) => ({
              type: transformation.type ?? undefined,
              path: transformation.path ?? undefined,
              reason: transformation.reason ?? undefined,
            })),
          },
        });
      }

      events.push({ type: "done", reason: output.stopReason, message: output });
      events.end();
    } catch (error) {
      for (const block of output.content) {
        delete (block as { index?: number }).index;
        delete (block as { partialJson?: string }).partialJson;
      }
      output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      events.push({ type: "error", reason: output.stopReason, error: output });
      events.end();
    }
  })();

  return events;
};

function mapThinkingLevelToEffort(
  model: Model<"anthropic-messages">,
  level: SimpleStreamOptions["reasoning"],
): AnthropicEffort {
  const mapped = level === undefined ? undefined : model.thinkingLevelMap?.[level];
  if (typeof mapped === "string") return mapped as AnthropicEffort;

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

export const streamSimple: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  if (
    getAnthropicFederation(model, options?.apiKey, options?.headers, options?.env) === undefined
  ) {
    assertRequestAuth(model.provider, options?.apiKey, options?.headers);
  }

  const base = {
    ...buildBaseOptions(model, context, options, options?.apiKey),
    toolChoice: options?.toolChoice,
  } satisfies AnthropicOptions;
  if (options?.reasoning === undefined) {
    return stream(model, context, {
      ...base,
      thinkingEnabled: false,
    } satisfies AnthropicOptions);
  }

  if (model.compat?.forceAdaptiveThinking === true) {
    const effort = mapThinkingLevelToEffort(model, options.reasoning);
    return stream(model, context, {
      ...base,
      thinkingEnabled: true,
      effort,
    } satisfies AnthropicOptions);
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
    thinkingEnabled: true,
    thinkingBudgetTokens: Math.min(adjusted.thinkingBudget, Math.max(0, maxTokens - 1024)),
  } satisfies AnthropicOptions);
};

function isOAuthToken(apiKey: string): boolean {
  return apiKey.includes("sk-ant-oat");
}

function createClient(
  model: Model<"anthropic-messages">,
  apiKey: string | undefined,
  optionsHeaders?: ProviderHeaders,
  fetch?: typeof globalThis.fetch,
  sessionId?: string,
  federation?: AnthropicFederationConfig,
): { client: Anthropic; isOAuthToken: boolean } {
  if (apiKey !== undefined && apiKey !== "" && isOAuthToken(apiKey)) {
    const client = new MsaAnthropic({
      apiKey: null,
      authToken: apiKey,
      baseURL: model.baseUrl,
      dangerouslyAllowBrowser: true,
      fetch,
      defaultHeaders: mergeClientHeaders(
        {
          accept: "application/json",
          "anthropic-dangerous-direct-browser-access": "true",
          "user-agent": `claude-cli/${claudeCodeVersion}`,
          "x-app": "cli",
        },
        model.headers,
        optionsHeaders,
      ),
    });

    return { client, isOAuthToken: true };
  }

  const compat = getAnthropicCompat(model);
  const sessionAffinityHeaders: ProviderHeaders = {};
  if (sessionId !== undefined && sessionId !== "" && compat.sendSessionAffinityHeaders) {
    const header =
      compat.sessionAffinityFormat === "openrouter" ? "x-session-id" : "x-session-affinity";
    sessionAffinityHeaders[header] = sessionId;
  }
  const defaultHeaders = mergeClientHeaders(
    {
      accept: "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    sessionAffinityHeaders,
    model.headers,
    optionsHeaders,
  );
  if (federation !== undefined) {
    const key = JSON.stringify([model.baseUrl, federation]);
    if (federationClient?.key !== key || federationClient.fetch !== fetch) {
      const client = new MsaAnthropic({
        apiKey: null,
        authToken: null,
        config: federation,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
        fetch,
      });
      federationClient = { key, fetch, client };
    }
    return { client: federationClient.client.withOptions({ defaultHeaders }), isOAuthToken: false };
  }

  const client = new MsaAnthropic({
    apiKey: apiKey ?? null,
    authToken: null,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch,
    defaultHeaders,
  });

  return { client, isOAuthToken: false };
}

function getBetaFeatures(
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  usesOAuth: boolean,
  nativeToolChanges: boolean,
  options?: AnthropicOptions,
): NonNullable<MessageCreateParamsStreaming["betas"]> {
  let configuredFeatures: string | null | undefined;
  for (const headers of [model.headers, options?.headers]) {
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (name.toLowerCase() === "anthropic-beta") configuredFeatures = value;
    }
  }
  if (configuredFeatures === null) return [];
  if (configuredFeatures !== undefined) {
    return [
      ...new Set(
        configuredFeatures
          .split(",")
          .map((feature) => feature.trim())
          .filter((feature) => feature.length > 0),
      ),
    ];
  }

  const features: NonNullable<MessageCreateParamsStreaming["betas"]> = [];
  if (usesOAuth) features.push("claude-code-20250219", "oauth-2025-04-20");
  if (shouldUseFineGrainedToolStreamingBeta(model, context))
    features.push(FINE_GRAINED_TOOL_STREAMING_BETA);
  if (
    model.reasoning &&
    options?.thinkingEnabled === true &&
    (options.interleavedThinking ?? true) &&
    model.compat?.forceAdaptiveThinking !== true
  ) {
    features.push(INTERLEAVED_THINKING_BETA);
  }
  if (shouldUseServerSideFallbackBeta(model)) features.push(SERVER_SIDE_FALLBACK_BETA);
  if (model.compat?.supportsMidConvoEffort === true) {
    features.push(MID_CONVERSATION_OUTPUT_CONFIG_BETA, THINKING_BINDING_CONTROLS_BETA);
  }
  if (nativeToolChanges) features.push(INLINE_TOOLS_BETA);
  return [...new Set(features)];
}

function buildParams(
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  usesOAuth: boolean,
  options?: AnthropicOptions,
  disablePreferredStrictTools = false,
): {
  params: MessageCreateParamsStreaming;
  hasPreferredStrictTools: boolean;
  providerThinkingLevel: AnthropicEffort | undefined;
} {
  const { cacheControl } = getCacheControl(model, options?.cacheRetention, options?.env);
  const compat = getAnthropicCompat(model);
  const initialSystemMessage = getInitialSystemMessage(context.messages);
  const initialSystemText =
    initialSystemMessage === undefined ? "" : getSystemMessageText(initialSystemMessage);
  const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);
  const conversationMessages =
    initialSystemMessage === undefined ? transformedMessages : transformedMessages.slice(1);
  let hasPreferredStrictTools = false;
  const convertToolDefinitions = (
    tools: Tool[],
    toolCacheControl?: CacheControlEphemeral,
  ): BetaTool[] => {
    const definitions = convertTools(
      tools,
      usesOAuth,
      compat.supportsEagerToolInputStreaming,
      compat.supportsStrictTools,
      toolCacheControl,
      disablePreferredStrictTools,
    );
    if (
      definitions.some((definition, index) => {
        const config = tools[index]?.constrainedSampling;
        return (
          definition.strict === true &&
          config &&
          config.type === "json_schema" &&
          config.strict === "prefer"
        );
      })
    ) {
      hasPreferredStrictTools = true;
    }
    return definitions;
  };
  const initialTools = initialSystemMessage?.toolsAdded ?? [];
  const nativeToolChanges =
    compat.supportsMidConvoSystemMessages &&
    compat.supportsMidConvoToolChanges &&
    initialTools.length > 0;
  const thinkingDisabled =
    model.reasoning && options?.thinkingEnabled === false && model.thinkingLevelMap?.off !== null;
  const effortMessages = model.compat?.supportsMidConvoEffort === true && !thinkingDisabled;
  const converted = convertMessages(
    conversationMessages,
    usesOAuth,
    cacheControl,
    compat.allowEmptySignature,
    effortMessages ? model.provider : undefined,
    nativeToolChanges ? convertToolDefinitions : undefined,
  );
  const activeEffort = options?.effort ?? "high";
  const betaFeatures = getBetaFeatures(model, context, usesOAuth, nativeToolChanges, options);
  const params: MessageCreateParamsStreaming = {
    model: model.id,
    messages: effortMessages
      ? insertThinkingLevelMessages(converted, activeEffort)
      : converted.messages,
    max_tokens: options?.maxTokens ?? model.maxTokens,
    stream: true,
    ...(betaFeatures.length > 0 ? { betas: betaFeatures } : {}),
  };

  if (usesOAuth) {
    params.system = [
      {
        type: "text",
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        ...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
      },
    ];
    if (initialSystemText !== "") {
      params.system.push({
        type: "text",
        text: sanitizeSurrogates(initialSystemText),
        ...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
      });
    }
  } else if (initialSystemText !== "") {
    params.system = [
      {
        type: "text",
        text: sanitizeSurrogates(initialSystemText),
        ...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
      },
    ];
  }

  if (
    options?.temperature !== undefined &&
    options?.thinkingEnabled !== true &&
    model.compat?.supportsMidConvoEffort !== true &&
    compat.supportsTemperature
  ) {
    params.temperature = options.temperature;
  }

  const toolCacheControl = compat.supportsCacheControlOnTools ? cacheControl : undefined;
  if (nativeToolChanges) {
    params.tools = [
      ...convertToolDefinitions(initialTools, toolCacheControl),
      DEFERRED_TOOL_PLACEHOLDER,
    ];
  } else {
    const tools = getCurrentTools(context.messages);
    if (tools.length > 0) {
      params.tools = convertToolDefinitions(tools, toolCacheControl);
    }
  }

  if (thinkingDisabled) {
    params.thinking = { type: "disabled" };
  } else if (effortMessages) {
    params.thinking = {
      type: "adaptive",
      display: options?.thinkingDisplay ?? "summarized",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    };
    params.output_config = { effort: "high" };
  } else if (model.reasoning && options?.thinkingEnabled === true) {
    const display: AnthropicThinkingDisplay = options.thinkingDisplay ?? "summarized";
    if (model.compat?.forceAdaptiveThinking === true) {
      params.thinking = { type: "adaptive", display };
      if (options.effort !== undefined) {
        params.output_config = { effort: options.effort };
      }
    } else {
      params.thinking = {
        type: "enabled",
        budget_tokens: options.thinkingBudgetTokens || 1024,
        display,
      };
    }
  }

  if (options?.metadata !== undefined) {
    const userId = options.metadata["user_id"];
    if (typeof userId === "string") {
      params.metadata = { user_id: userId };
    }
  }

  if (options?.toolChoice !== undefined) {
    if (typeof options.toolChoice === "string") {
      params.tool_choice = { type: options.toolChoice };
    } else {
      params.tool_choice = options.toolChoice;
    }
  }

  const allowedFallbackModels = model.compat?.allowedFallbackModels;
  if (allowedFallbackModels !== undefined && allowedFallbackModels.length > 0) {
    params.fallbacks = allowedFallbackModels.map((fallback) => ({ model: fallback.model }));
  }

  return {
    params,
    hasPreferredStrictTools,
    providerThinkingLevel: effortMessages ? activeEffort : undefined,
  };
}

function normalizeToolCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length)).slice(0, 64);
}

function convertToolResult(msg: ToolResultMessage): ContentBlockParam {
  const content = msg.isError
    ? msg.content.map((block) =>
        block.type === "image"
          ? {
              type: "text" as const,
              text: "[image omitted: error tool results cannot contain images]",
            }
          : block,
      )
    : msg.content;
  return {
    type: "tool_result",
    tool_use_id: msg.toolCallId,
    content: convertContentBlocks(content),
    is_error: msg.isError,
  };
}

interface ConvertedAnthropicMessages {
  messages: MessageParam[];
  assistantLevels: Map<number, AnthropicEffort>;
}

function convertMessages(
  transformedMessages: Message[],
  usesOAuth: boolean,
  cacheControl?: CacheControlEphemeral,
  allowEmptySignature = false,
  managedProvider?: string,
  convertToolDefinitions?: (tools: Tool[]) => BetaTool[],
): ConvertedAnthropicMessages {
  const params: MessageParam[] = [];
  const assistantLevels = new Map<number, AnthropicEffort>();
  const pendingSystemMessages: MessageParam[] = [];
  const flushPendingSystemMessages = (): void => {
    params.push(...pendingSystemMessages);
    pendingSystemMessages.length = 0;
  };

  for (let i = 0; i < transformedMessages.length; i++) {
    const msg = transformedMessages[i];
    if (msg === undefined) continue;

    if (msg.role === "system") {
      const text = renderSystemMessageUpdate(msg);
      const blocks: ContentBlockParam[] = [];
      if (text.length > 0) blocks.push({ type: "text", text: sanitizeSurrogates(text) });
      if (convertToolDefinitions !== undefined) {
        const added = msg.toolsAdded ?? [];
        const redefined = new Set(added.map((tool) => tool.name));
        for (const tool of msg.toolsRemoved ?? []) {
          if (redefined.has(tool.name)) continue;
          blocks.push({
            type: "tool_removal",
            tool: {
              type: "tool_reference",
              name: usesOAuth ? toClaudeCodeName(tool.name) : tool.name,
            },
          });
        }
        for (const definition of convertToolDefinitions(added)) {
          blocks.push({ type: "tool_addition", tool: { type: "tool_definition", definition } });
        }
      }
      if (blocks.length > 0) pendingSystemMessages.push({ role: "system", content: blocks });
    } else if (msg.role === "user") {
      if (typeof msg.content === "string") {
        if (msg.content.trim().length > 0) {
          params.push({
            role: "user",
            content: sanitizeSurrogates(msg.content),
          });
        }
      } else {
        const blocks: ContentBlockParam[] = msg.content.map((item) => {
          if (item.type === "text") {
            return {
              type: "text",
              text: sanitizeSurrogates(item.text),
            };
          }
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: item.data,
            },
          };
        });
        const filteredBlocks = blocks.filter((b) => {
          if (b.type === "text") {
            return b.text.trim().length > 0;
          }
          return true;
        });
        if (filteredBlocks.length === 0) continue;
        params.push({
          role: "user",
          content: filteredBlocks,
        });
      }
    } else if (msg.role === "assistant") {
      flushPendingSystemMessages();
      const blocks: ContentBlockParam[] = [];

      for (const block of msg.content) {
        if (block.type === "text") {
          if (block.text.trim().length === 0) continue;
          blocks.push({
            type: "text",
            text: sanitizeSurrogates(block.text),
          });
        } else if (block.type === "thinking") {
          if (block.redacted === true) {
            blocks.push({
              type: "redacted_thinking",
              data: block.thinkingSignature!,
            });
            continue;
          }
          const thinkingSignature = block.thinkingSignature;
          const hasThinkingSignature =
            thinkingSignature !== undefined &&
            thinkingSignature !== "" &&
            thinkingSignature.trim().length > 0;
          if (block.thinking.trim().length === 0 && !hasThinkingSignature) continue;
          if (hasThinkingSignature) {
            blocks.push({
              type: "thinking",
              thinking: sanitizeSurrogates(block.thinking),
              signature: thinkingSignature,
            });
          } else {
            blocks.push(
              allowEmptySignature
                ? {
                    type: "thinking",
                    thinking: sanitizeSurrogates(block.thinking),
                    signature: "",
                  }
                : {
                    type: "text",
                    text: sanitizeSurrogates(block.thinking),
                  },
            );
          }
        } else if (block.type === "toolCall") {
          blocks.push({
            type: "tool_use",
            id: block.id,
            name: usesOAuth ? toClaudeCodeName(block.name) : block.name,
            input: block.arguments ?? {},
          });
        }
      }
      if (blocks.length === 0) continue;
      const messageIndex = params.length;
      params.push({
        role: "assistant",
        content: blocks,
      });
      if (
        managedProvider !== undefined &&
        msg.api === "anthropic-messages" &&
        msg.provider === managedProvider &&
        isAnthropicEffort(msg.providerThinkingLevel)
      ) {
        assistantLevels.set(messageIndex, msg.providerThinkingLevel);
      }
    } else if (msg.role === "toolResult") {
      const toolResults: ContentBlockParam[] = [];
      let j = i;
      let next = transformedMessages[j];
      while (next?.role === "toolResult") {
        toolResults.push(convertToolResult(next));
        next = transformedMessages[++j];
      }

      i = j - 1;

      params.push({
        role: "user",
        content: toolResults,
      });
    }
  }

  flushPendingSystemMessages();

  if (cacheControl !== undefined && params.length > 0) {
    const lastMessage = params.at(-1);
    if (lastMessage?.role === "user" || lastMessage?.role === "system") {
      if (Array.isArray(lastMessage.content)) {
        const lastBlock = lastMessage.content[lastMessage.content.length - 1];
        if (
          lastBlock !== undefined &&
          (lastBlock.type === "text" ||
            lastBlock.type === "image" ||
            lastBlock.type === "tool_result" ||
            lastBlock.type === "tool_addition" ||
            lastBlock.type === "tool_removal")
        ) {
          (lastBlock as any).cache_control = cacheControl;
        }
      } else if (typeof lastMessage.content === "string") {
        lastMessage.content = [
          {
            type: "text",
            text: lastMessage.content,
            cache_control: cacheControl,
          },
        ] as any;
      }
    }
  }

  return { messages: params, assistantLevels };
}

function isAnthropicEffort(value: unknown): value is AnthropicEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function insertThinkingLevelMessages(
  converted: ConvertedAnthropicMessages,
  activeEffort: AnthropicEffort,
): MessageParam[] {
  const messages: MessageParam[] = [];
  for (const [index, message] of converted.messages.entries()) {
    const historicalEffort = converted.assistantLevels.get(index);
    if (historicalEffort !== undefined) {
      messages.push({ role: "system", content: [], output_config: { effort: historicalEffort } });
    }
    messages.push(message);
  }
  messages.push({ role: "system", content: [], output_config: { effort: activeEffort } });
  return messages;
}

function shouldUseFineGrainedToolStreamingBeta(
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
): boolean {
  return (
    getCurrentTools(context.messages).length > 0 &&
    !getAnthropicCompat(model).supportsEagerToolInputStreaming
  );
}

const ANTHROPIC_STRICT_UNSUPPORTED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
  "uniqueItems",
  "minContains",
  "maxContains",
  "minProperties",
  "maxProperties",
]);
const ANTHROPIC_STRICT_STRING_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

const isAnthropicStrictUnsupportedKeyword: UnsupportedStrictSchemaKeywordCheck = (key, value) => {
  if (ANTHROPIC_STRICT_UNSUPPORTED_KEYWORDS.has(key)) return true;
  if (key === "minItems") return value !== 0 && value !== 1;
  if (key === "format")
    return typeof value !== "string" || !ANTHROPIC_STRICT_STRING_FORMATS.has(value);
  return false;
};

function convertTools(
  tools: Tool[],
  usesOAuth: boolean,
  supportsEagerToolInputStreaming: boolean,
  supportsStrictTools: boolean,
  cacheControl?: CacheControlEphemeral,
  disablePreferredStrictTools = false,
): BetaTool[] {
  if (!tools) return [];

  return tools.map((tool, index) => {
    const config = tool.constrainedSampling;
    const strict =
      disablePreferredStrictTools &&
      config !== undefined &&
      config !== false &&
      config.type === "json_schema" &&
      config.strict === "prefer"
        ? undefined
        : resolveJsonSchemaStrictSampling(
            tool,
            supportsStrictTools,
            isAnthropicStrictUnsupportedKeyword,
          );
    const parameters = getJsonSchemaToolParameters(tool, strict);
    const schema = parameters as { properties?: unknown; required?: string[] };
    const legacyInputSchema = {
      type: "object" as const,
      properties: schema.properties ?? {},
      required: schema.required ?? [],
    };
    const inputSchema =
      strict === true
        ? {
            ...(parameters as Record<string, unknown>),
            ...legacyInputSchema,
          }
        : legacyInputSchema;

    return {
      name: usesOAuth ? toClaudeCodeName(tool.name) : tool.name,
      description: tool.description,
      ...(supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {}),
      ...(strict === true ? { strict: true } : {}),
      input_schema: inputSchema,
      ...(cacheControl !== undefined && index === tools.length - 1
        ? { cache_control: cacheControl }
        : {}),
    };
  });
}

function mapStopReason(
  reason: BetaStopReason | string,
  stopDetails?: RefusalStopDetails | null,
): { stopReason: StopReason; errorMessage?: string } {
  switch (reason) {
    case "end_turn":
      return { stopReason: "stop" };
    case "max_tokens":
      return { stopReason: "length" };
    case "tool_use":
      return { stopReason: "toolUse" };
    case "refusal":
      return {
        stopReason: "error",
        errorMessage: stopDetails?.explanation || `The model refused to complete the request`,
      };
    case "pause_turn":
      return { stopReason: "stop" };
    case "stop_sequence":
      return { stopReason: "stop" };
    case "sensitive":
      return { stopReason: "error", errorMessage: "Provider stopped with: sensitive" };
    default:
      throw new Error(`Unhandled stop reason: ${reason}`);
  }
}
