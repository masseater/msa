import { Data, Effect, Option, Stream } from "effect";

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
import { currentTimeMillis } from "../utils/clock.ts";
import {
  appendAssistantMessageDiagnostic,
  createAssistantMessageDiagnostic,
} from "../utils/diagnostics.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.ts";
import { callHook } from "../utils/hooks.ts";
import { encodeJson } from "../utils/json-codec.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { modelCall } from "../utils/model-call.ts";
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

export class MsaMessagesResponseError extends Data.TaggedError("MsaMessagesResponseError")<{
  readonly message: string;
  readonly code: string | undefined;
  readonly diagnosticDetails: JsonObject;
}> {}

function parseMsaMessagesErrorBody(body: string): MsaMessagesErrorBody | undefined {
  try {
    const parsed = JSON.parse(body) as MsaMessagesErrorBody | null;
    const error = parsed?.error;
    return parsed !== null && typeof error === "object" && error !== null && !Array.isArray(error)
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
  const codeSuffix = code !== undefined && code !== "" ? ` (${code})` : "";
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
  return new MsaMessagesResponseError({
    message: formatMsaMessagesResponseError(response, body, errorBody),
    code,
    diagnosticDetails: {
      version: 1,
      provider: model.provider,
      model: model.id,
      url: url.toString(),
      status: response.status,
      statusText: response.statusText,
      ...(errorBody?.error === undefined ? {} : { error: errorBody.error as JsonValue }),
      ...(errorBody === undefined ? { body: truncateDiagnosticString(body) } : {}),
      timestampMs: currentTimeMillis(),
    },
  });
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
  if (rewrite === undefined) {
    return;
  }
  appendAssistantMessageDiagnostic(message, {
    type: "pi_messages_rewrite",
    timestamp: currentTimeMillis(),
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
    timestamp: currentTimeMillis(),
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

const splitMsaMessagesEvents = (
  buffer: string,
): readonly [rest: string, events: ReadonlyArray<MsaMessagesEvent>] => {
  const events: MsaMessagesEvent[] = [];
  let rest = buffer.replace(/\r\n/gu, "\n");
  let split = rest.indexOf("\n\n");
  while (split !== -1) {
    const event = parseMsaMessagesEvent(rest.slice(0, split));
    if (event !== undefined) events.push(event);
    rest = rest.slice(split + 2);
    split = rest.indexOf("\n\n");
  }
  return [rest, events];
};

function readMsaMessagesEvents(
  stream: ReadableStream<Uint8Array>,
): Stream.Stream<MsaMessagesEvent> {
  const decoder = new TextDecoder();
  return Stream.fromReadableStream({
    evaluate: () => stream,
    onError: (error) => error,
    releaseLockOnEnd: true,
  }).pipe(
    Stream.orDie,
    Stream.map((value) => decoder.decode(value, { stream: true })),
    Stream.concat(Stream.sync(() => decoder.decode())),
    Stream.mapAccum(
      () => "",
      (buffer, text: string) => splitMsaMessagesEvents(buffer + text),
      {
        onHalt: (buffer) => {
          if (buffer.trim() === "") return [];
          const event = parseMsaMessagesEvent(buffer);
          return event === undefined ? [] : [event];
        },
      },
    ),
  );
}

function parseMsaMessagesEvent(raw: string): MsaMessagesEvent | undefined {
  const data = raw
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();

  return data !== undefined && data !== "" && data !== "[DONE]"
    ? (JSON.parse(data) as MsaMessagesEvent)
    : undefined;
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
    timestamp: currentTimeMillis(),
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
  if (cacheRetention !== undefined) {
    return cacheRetention;
  }
  return getProviderEnvValue("MSA_CACHE_RETENTION", env) === "long" ? "long" : undefined;
}

const requestMsaMessages = Effect.fn("requestMsaMessages")(function* (
  model: Model<"msa-messages">,
  context: TranscriptContext,
  options: MsaMessagesOptions | undefined,
) {
  const apiKey = options?.apiKey;
  if (apiKey === undefined || apiKey === "") {
    return yield* Effect.die(new Error(`No API key provided for provider "${model.provider}"`));
  }

  const url = new URL(`${model.baseUrl.replace(/\/+$/u, "")}/messages`);
  if (options?.debug === true) {
    url.searchParams.set("debug", "1");
  }

  const payload: unknown = {
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
  const nextPayload = yield* callHook(() => options?.onPayload?.(payload, model));
  const body = yield* encodeJson(nextPayload === undefined ? payload : nextPayload);

  const response = yield* Effect.promise(() =>
    (options?.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "text/event-stream",
        "content-type": "application/json",
        ...providerHeadersToRecord(options?.headers),
      },
      body,
      signal: options?.signal ?? null,
    }),
  );

  yield* callHook(() =>
    options?.onResponse?.(
      { status: response.status, headers: headersToRecord(response.headers) },
      model,
    ),
  );

  if (!response.ok) {
    const text = yield* Effect.promise(() => response.text());
    return yield* Effect.die(createMsaMessagesResponseError(model, url, response, text));
  }
  if (response.body === null) {
    return yield* Effect.die(new Error(`${model.provider} response has no body`));
  }
  return readMsaMessagesEvents(response.body);
});

export const stream = modelCall<
  Parameters<StreamFunction<"msa-messages", MsaMessagesOptions>>[0],
  Parameters<StreamFunction<"msa-messages", MsaMessagesOptions>>[1],
  NonNullable<Parameters<StreamFunction<"msa-messages", MsaMessagesOptions>>[2]>,
  ReturnType<StreamFunction<"msa-messages", MsaMessagesOptions>>
>(
  (
    model: Model<"msa-messages">,
    context: TranscriptContext,
    options?: MsaMessagesOptions,
  ): AssistantMessageEventStream => {
    const eventStream = new AssistantMessageEventStream();
    const convertEvent = createEventConverter(model);

    Effect.runFork(
      requestMsaMessages(model, context, options).pipe(
        Effect.flatMap((events) =>
          events.pipe(
            Stream.mapEffect((msaEvent) =>
              callHook(() => options?.onProviderStreamEvent?.(msaEvent, model)).pipe(
                Effect.map(() => {
                  const event = convertEvent(msaEvent);
                  eventStream.push(event);
                  return event.type === "done" || event.type === "error";
                }),
              ),
            ),
            Stream.takeUntil((terminal) => terminal),
            Stream.runLast,
          ),
        ),
        Effect.flatMap((last) =>
          Option.getOrElse(last, () => false)
            ? Effect.void
            : Effect.die(new Error(`${model.provider} stream ended without a terminal event`)),
        ),
        Effect.catchDefect((error) =>
          Effect.sync(() =>
            eventStream.push(createErrorEvent(model, error, options?.signal?.aborted ?? false)),
          ),
        ),
      ),
    );

    return eventStream;
  },
);

export const streamSimple = modelCall<
  Parameters<StreamFunction<"msa-messages", SimpleStreamOptions>>[0],
  Parameters<StreamFunction<"msa-messages", SimpleStreamOptions>>[1],
  NonNullable<Parameters<StreamFunction<"msa-messages", SimpleStreamOptions>>[2]>,
  ReturnType<StreamFunction<"msa-messages", SimpleStreamOptions>>
>(
  (
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
  },
);
