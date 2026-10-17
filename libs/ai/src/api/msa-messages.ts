import type {
  AssistantMessage,
  AssistantMessageEvent,
  CacheRetention,
  JsonObject,
  JsonValue,
  Model,
  ProviderEnv,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  ThinkingLevel,
  ToolCall,
  TranscriptContext,
} from "../types.ts";
import {
  appendAssistantMessageDiagnostic,
  createAssistantMessageDiagnostic,
} from "../utils/diagnostics.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";

export interface MsaMessagesOptions extends StreamOptions {
  reasoning?: ThinkingLevel | undefined;
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } }
    | undefined;
  debug?: boolean | undefined;
}

type MsaMessagesUsage = AssistantMessage["usage"];
type MsaMessagesStopReason = AssistantMessage["stopReason"];

export type MsaMessagesRewriteImpact = {
  policyId: string;
  policyVersion: number;
  changed: boolean;
  tokenCountChange: number;
  messageCountChange: number;
  systemPromptChanged: boolean;
};

export type MsaMessagesEvent =
  | { type: "start" }
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; content: string; contentSignature?: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | {
      type: "thinking_end";
      contentIndex: number;
      content: string;
      contentSignature?: string;
      redacted?: boolean;
    }
  | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall }
  | {
      type: "done";
      reason: Extract<MsaMessagesStopReason, "stop" | "length" | "toolUse">;
      usage: MsaMessagesUsage;
      responseId?: string;
      providerThinkingLevel?: string;
      rewrite?: MsaMessagesRewriteImpact;
    }
  | {
      type: "error";
      reason: Extract<MsaMessagesStopReason, "aborted" | "error">;
      usage: MsaMessagesUsage;
      errorMessage?: string;
      responseId?: string;
      providerThinkingLevel?: string;
      rewrite?: MsaMessagesRewriteImpact;
    };

type MsaMessagesErrorBody = {
  error?: {
    message?: unknown;
    code?: unknown;
    details?: unknown;
    [key: string]: unknown;
  };
};

export class MsaMessagesResponseError extends Error {
  code?: string | undefined;
  readonly diagnosticDetails: JsonObject;

  constructor(message: string, code: string | undefined, diagnosticDetails: JsonObject) {
    super(message);
    this.name = "MsaMessagesResponseError";
    this.code = code;
    this.diagnosticDetails = diagnosticDetails;
  }
}

function parseMsaMessagesErrorBody(body: string): MsaMessagesErrorBody | undefined {
  try {
    const parsed = JSON.parse(body) as MsaMessagesErrorBody | null;
    const error = parsed?.error;
    return parsed && typeof error === "object" && error !== null && !Array.isArray(error)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function truncateDiagnosticString(value: string): string {
  const maxLength = 8192;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function formatMsaMessagesResponseError(
  response: Response,
  body: string,
  errorBody: MsaMessagesErrorBody | undefined,
): string {
  const message =
    typeof errorBody?.error?.message === "string" ? errorBody.error.message : undefined;
  const code = typeof errorBody?.error?.code === "string" ? errorBody.error.code : undefined;
  const suffix = message ?? body;
  const codeSuffix = code ? ` (${code})` : "";
  return `${response.status} ${response.statusText}: ${suffix}${codeSuffix}`;
}

function createMsaMessagesResponseError(
  model: Model<"msa-messages">,
  url: URL,
  response: Response,
  body: string,
): MsaMessagesResponseError {
  const errorBody = parseMsaMessagesErrorBody(body);
  const code = typeof errorBody?.error?.code === "string" ? errorBody.error.code : undefined;
  return new MsaMessagesResponseError(
    formatMsaMessagesResponseError(response, body, errorBody),
    code,
    {
      version: 1,
      provider: model.provider,
      model: model.id,
      url: url.toString(),
      status: response.status,
      statusText: response.statusText,
      ...(errorBody?.error === undefined ? {} : { error: errorBody.error as JsonValue }),
      ...(errorBody ? {} : { body: truncateDiagnosticString(body) }),
      timestampMs: Date.now(),
    },
  );
}

function createEmptyUsage(): MsaMessagesUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function appendRewriteDiagnostic(
  message: AssistantMessage,
  rewrite: MsaMessagesRewriteImpact | undefined,
): void {
  if (!rewrite) {
    return;
  }
  appendAssistantMessageDiagnostic(message, {
    type: "pi_messages_rewrite",
    timestamp: Date.now(),
    details: { ...rewrite },
  });
}

function createEventConverter(model: Model<"msa-messages">) {
  const partial: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: createEmptyUsage(),
    stopReason: "pending",
    timestamp: Date.now(),
  };
  const toolJson = new Map<number, string>();

  return (event: MsaMessagesEvent): AssistantMessageEvent => {
    switch (event.type) {
      case "done":
        Object.assign(partial, {
          stopReason: event.reason,
          usage: event.usage,
          responseId: event.responseId,
        });
        if (event.providerThinkingLevel !== undefined) {
          partial.providerThinkingLevel = event.providerThinkingLevel;
        }
        appendRewriteDiagnostic(partial, event.rewrite);
        return { type: "done", reason: event.reason, message: partial };
      case "error":
        Object.assign(partial, {
          stopReason: event.reason,
          usage: event.usage,
          errorMessage: event.errorMessage,
          responseId: event.responseId,
        });
        if (event.providerThinkingLevel !== undefined) {
          partial.providerThinkingLevel = event.providerThinkingLevel;
        }
        appendRewriteDiagnostic(partial, event.rewrite);
        return { type: "error", reason: event.reason, error: partial };
      case "start":
        break;
      case "text_start":
        partial.content[event.contentIndex] = { type: "text", text: "" };
        break;
      case "text_delta":
        (partial.content[event.contentIndex] as { text: string }).text += event.delta;
        break;
      case "text_end":
        Object.assign(partial.content[event.contentIndex]!, {
          text: event.content,
          textSignature: event.contentSignature,
        });
        break;
      case "thinking_start":
        partial.content[event.contentIndex] = { type: "thinking", thinking: "" };
        break;
      case "thinking_delta":
        (partial.content[event.contentIndex] as { thinking: string }).thinking += event.delta;
        break;
      case "thinking_end":
        Object.assign(partial.content[event.contentIndex]!, {
          thinking: event.content,
          thinkingSignature: event.contentSignature,
          redacted: event.redacted,
        });
        break;
      case "toolcall_start":
        partial.content[event.contentIndex] = {
          type: "toolCall",
          id: event.id,
          name: event.toolName,
          arguments: {},
        };
        toolJson.set(event.contentIndex, "");
        break;
      case "toolcall_delta": {
        const json = `${toolJson.get(event.contentIndex) ?? ""}${event.delta}`;
        toolJson.set(event.contentIndex, json);
        (partial.content[event.contentIndex] as ToolCall).arguments =
          parseStreamingJson<ToolCall["arguments"]>(json);
        break;
      }
      case "toolcall_end":
        Object.assign(partial.content[event.contentIndex]!, event.toolCall);
        toolJson.delete(event.contentIndex);
        return {
          type: "toolcall_end",
          contentIndex: event.contentIndex,
          toolCall: partial.content[event.contentIndex] as ToolCall,
          partial,
        };
    }

    return { ...event, partial } as AssistantMessageEvent;
  };
}

async function* readMsaMessagesEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<MsaMessagesEvent> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/gu, "\n");

      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const event = parseMsaMessagesEvent(buffer.slice(0, split));
        if (event) {
          yield event;
        }
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf("\n\n");
      }

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      const event = parseMsaMessagesEvent(buffer);
      if (event) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseMsaMessagesEvent(raw: string): MsaMessagesEvent | undefined {
  const data = raw
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();

  return data && data !== "[DONE]" ? (JSON.parse(data) as MsaMessagesEvent) : undefined;
}

function createErrorEvent(
  model: Model<"msa-messages">,
  error: unknown,
  aborted: boolean,
): AssistantMessageEvent {
  const reason = aborted ? "aborted" : "error";
  const assistantMessage: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: createEmptyUsage(),
    stopReason: reason,
    errorMessage: toErrorMessage(error),
    timestamp: Date.now(),
  };

  if (!aborted && error instanceof MsaMessagesResponseError) {
    appendAssistantMessageDiagnostic(
      assistantMessage,
      createAssistantMessageDiagnostic(
        "pi_messages_response_failure",
        error,
        error.diagnosticDetails,
      ),
    );
  }

  return { type: "error", reason, error: assistantMessage };
}

function resolveCacheRetention(
  cacheRetention?: CacheRetention,
  env?: ProviderEnv,
): CacheRetention | undefined {
  if (cacheRetention) {
    return cacheRetention;
  }
  return getProviderEnvValue("MSA_CACHE_RETENTION", env) === "long" ? "long" : undefined;
}

export const stream: StreamFunction<"msa-messages", MsaMessagesOptions> = (
  model: Model<"msa-messages">,
  context: TranscriptContext,
  options?: MsaMessagesOptions,
): AssistantMessageEventStream => {
  const eventStream = new AssistantMessageEventStream();
  const convertEvent = createEventConverter(model);

  void (async () => {
    try {
      const apiKey = options?.apiKey;
      if (!apiKey) {
        throw new Error(`No API key provided for provider "${model.provider}"`);
      }

      const url = new URL(`${model.baseUrl.replace(/\/+$/u, "")}/messages`);
      if (options?.debug) {
        url.searchParams.set("debug", "1");
      }

      let payload: unknown = {
        model: model.id,
        context,
        options: {
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
          reasoning: options?.reasoning,
          cacheRetention: resolveCacheRetention(options?.cacheRetention, options?.env),
          sessionId: options?.sessionId,
          toolChoice: options?.toolChoice,
        },
      };
      const nextPayload = await options?.onPayload?.(payload, model);
      if (nextPayload !== undefined) {
        payload = nextPayload;
      }

      const response = await (options?.fetch ?? globalThis.fetch)(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "text/event-stream",
          "content-type": "application/json",
          ...providerHeadersToRecord(options?.headers),
        },
        body: JSON.stringify(payload),
        signal: options?.signal ?? null,
      });

      await options?.onResponse?.(
        { status: response.status, headers: headersToRecord(response.headers) },
        model,
      );

      if (!response.ok) {
        const body = await response.text();
        throw createMsaMessagesResponseError(model, url, response, body);
      }
      if (!response.body) {
        throw new Error(`${model.provider} response has no body`);
      }

      for await (const msaEvent of readMsaMessagesEvents(response.body)) {
        await options?.onProviderStreamEvent?.(msaEvent, model);
        const event = convertEvent(msaEvent);
        eventStream.push(event);
        if (event.type === "done" || event.type === "error") {
          return;
        }
      }

      throw new Error(`${model.provider} stream ended without a terminal event`);
    } catch (error) {
      eventStream.push(createErrorEvent(model, error, options?.signal?.aborted ?? false));
    }
  })();

  return eventStream;
};

export const streamSimple: StreamFunction<"msa-messages", SimpleStreamOptions> = (
  model: Model<"msa-messages">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const extra = options as MsaMessagesOptions | undefined;
  return stream(model, context, {
    ...options,
    reasoning: options?.reasoning,
    toolChoice: options?.toolChoice,
    debug: extra?.debug,
  });
};
