import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@msa/ai";
import { Cause, Data, Effect, Exit, Function, Layer, Option, Schema, Stream, Tracer } from "effect";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http";

import { now } from "./call.ts";
import { processProxyEvent, type ProxyAssistantMessageEvent } from "./proxy-events.ts";

export type { ProxyAssistantMessageEvent } from "./proxy-events.ts";

type ProxySerializableStreamOptions = {
  [
    K in
      | "temperature"
      | "samplingParams"
      | "maxTokens"
      | "reasoning"
      | "cacheRetention"
      | "sessionId"
      | "headers"
      | "metadata"
      | "transport"
      | "thinkingBudgets"
      | "maxRetryDelayMs"
  ]?: SimpleStreamOptions[K] | undefined;
};

export interface ProxyStreamOptions extends ProxySerializableStreamOptions {
  signal?: AbortSignal;

  authToken: string;

  proxyUrl: string;
}

function buildProxyRequestOptions(options: ProxyStreamOptions): ProxySerializableStreamOptions {
  return {
    temperature: options.temperature,
    samplingParams: options.samplingParams,
    maxTokens: options.maxTokens,
    reasoning: options.reasoning,
    cacheRetention: options.cacheRetention,
    sessionId: options.sessionId,
    headers: options.headers,
    metadata: options.metadata,
    transport: options.transport,
    thinkingBudgets: options.thinkingBudgets,
    maxRetryDelayMs: options.maxRetryDelayMs,
  };
}

class ProxyError extends Data.TaggedError("ProxyError")<{ readonly message: string }> {}

const globalFetch = (): typeof globalThis.fetch => globalThis.fetch;

type Received = { statusText: string };

const httpLayer = (received: Received) =>
  Layer.mergeAll(
    Layer.succeed(Tracer.DisablePropagation, true),
    FetchHttpClient.layer,
    Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
      globalFetch()(input, init).then((response) => {
        received.statusText = response.statusText;
        return response;
      }),
    ),
  );

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const decodeErrorBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.optional(Schema.String) })),
);

const initialPartial = (model: Model<any>): AssistantMessage => ({
  role: "assistant",
  stopReason: "pending",
  content: [],
  api: model.api,
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
  timestamp: now(),
});

interface ProxyRequest {
  readonly model: Model<any>;
  readonly context: TranscriptContext;
  readonly options: ProxyStreamOptions;
}

const errorFromBody = (status: string, body: string): string => {
  const error = Option.getOrUndefined(decodeErrorBody(body))?.error;
  return error === undefined || error === "" ? status : `Proxy error: ${error}`;
};

const openProxy = ({ model, context, options }: ProxyRequest, received: Received) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const body = yield* Effect.orDie(
      encodeJson({ model, context, options: buildProxyRequestOptions(options) }),
    );
    const request = HttpClientRequest.post(`${options.proxyUrl}/api/stream`).pipe(
      HttpClientRequest.setHeaders({ Authorization: `Bearer ${options.authToken}` }),
      HttpClientRequest.setBody(HttpBody.raw(body, { contentType: "application/json" })),
    );
    const response = yield* Effect.orDie(client.execute(request));
    if (response.status >= 200 && response.status < 300) return response;
    const text = yield* Effect.orElseSucceed(response.text, () => "");
    return yield* new ProxyError({
      message: errorFromBody(`Proxy error: ${response.status} ${received.statusText}`, text),
    });
  });

interface ProxyRead {
  readonly partial: AssistantMessage;
  readonly stream: AssistantMessageEventStream;
}

const readLine = ({ partial, stream }: ProxyRead, line: string) =>
  Effect.gen(function* () {
    if (!line.startsWith("data: ")) return false;
    const data = line.slice(6).trim();
    if (data === "") return false;
    const event = (yield* Effect.orDie(decodeJson(data))) as ProxyAssistantMessageEvent;
    const outcome = processProxyEvent({ event, partial });
    if (!outcome.known) {
      yield* Effect.logWarning(`Unhandled proxy event type: ${String(outcome.type)}`);
      return false;
    }
    if (outcome.event === undefined) return false;
    stream.push(outcome.event);
    return outcome.event.type === "done" || outcome.event.type === "error";
  });

const readResponse = (request: ProxyRequest, read: ProxyRead, received: Received) =>
  Effect.gen(function* () {
    const response = yield* openProxy(request, received);
    let sawTerminalEvent = false;
    yield* response.stream.pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.runForEach((line) =>
        Effect.map(readLine(read, line), (terminal) => {
          if (terminal) sawTerminalEvent = true;
        }),
      ),
      Effect.orDie,
    );
    return sawTerminalEvent;
  });

const readProxy = (request: ProxyRequest, read: ProxyRead) => {
  const received: Received = { statusText: "" };
  return Effect.scoped(
    Effect.flatMap(Layer.build(httpLayer(received)), (services) =>
      Effect.provideContext(readResponse(request, read, received), services),
    ),
  );
};

const abortedBy = (signal: AbortSignal) =>
  Effect.callback<never, ProxyError>((resume) => {
    const onAbort = () =>
      resume(Effect.fail(new ProxyError({ message: "Request aborted by user" })));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });

const fail = (read: ProxyRead, message: string, aborted: boolean): void => {
  read.partial.stopReason = aborted ? "aborted" : "error";
  read.partial.errorMessage = message;
  read.stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: read.partial });
};

const streamProxyEffect = (request: ProxyRequest, read: ProxyRead): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { signal } = request.options;
    const reading = readProxy(request, read);
    const exit = yield* Effect.exit(
      signal === undefined ? reading : Effect.raceFirst(reading, abortedBy(signal)),
    );
    if (Exit.isSuccess(exit)) {
      if (!exit.value) {
        fail(read, "Connection closed by proxy server before the response completed", false);
      }
    } else {
      const error = Cause.squash(exit.cause);
      fail(read, error instanceof Error ? error.message : String(error), signal?.aborted === true);
    }
    read.stream.end();
  });

export const streamProxy: {
  (
    context: TranscriptContext,
    options: ProxyStreamOptions,
  ): (model: Model<any>) => AssistantMessageEventStream;
  (
    model: Model<any>,
    context: TranscriptContext,
    options: ProxyStreamOptions,
  ): AssistantMessageEventStream;
} = Function.dual(
  3,
  (
    model: Model<any>,
    context: TranscriptContext,
    options: ProxyStreamOptions,
  ): AssistantMessageEventStream => {
    const stream = createAssistantMessageEventStream();
    const read = { partial: initialPartial(model), stream };
    Effect.runFork(streamProxyEffect({ model, context, options }, read));
    return stream;
  },
);
