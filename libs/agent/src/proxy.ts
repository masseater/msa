import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Cause, Data, Effect, Exit, Function, Layer, Option, Schema, Stream, Tracer } from "effect";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http";

import callModule from "./call.ts";
import proxyEvents from "./proxy-events.ts";
import type proxyEventsTypes from "./proxy-events.types.ts";
import type proxyTypes from "./proxy.types.ts";

const { createAssistantMessageEventStream } = ai;

const { now } = callModule;
const { processProxyEvent } = proxyEvents;

function buildProxyRequestOptions(
  options: proxyTypes.ProxyStreamOptions,
): proxyTypes.ProxySerializableStreamOptions {
  return {
    cacheRetention: options.cacheRetention,
    headers: options.headers,
    maxRetryDelayMs: options.maxRetryDelayMs,
    maxTokens: options.maxTokens,
    metadata: options.metadata,
    reasoning: options.reasoning,
    samplingParams: options.samplingParams,
    sessionId: options.sessionId,
    temperature: options.temperature,
    thinkingBudgets: options.thinkingBudgets,
    transport: options.transport,
  };
}

class ProxyError extends Data.TaggedError("ProxyError")<{
  readonly message: string;
  readonly status?: number;
}> {}

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

const initialPartial = (model: aiTypes.Model<any>): aiTypes.AssistantMessage => ({
  api: model.api,
  content: [],
  model: model.id,
  provider: model.provider,
  role: "assistant",
  stopReason: "pending",
  timestamp: now(),
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
  },
});

interface ProxyRequest {
  readonly model: aiTypes.Model<any>;
  readonly context: aiTypes.TranscriptContext;
  readonly options: proxyTypes.ProxyStreamOptions;
}

const errorFromBody = (status: string, body: string): string => {
  const error = Option.getOrUndefined(decodeErrorBody(body))?.error;
  return error === undefined || error === "" ? status : `Proxy error: ${error}`;
};

const openProxy = ({ model, context, options }: ProxyRequest, received: Received) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const body = yield* Effect.orDie(
      encodeJson({ context, model, options: buildProxyRequestOptions(options) }),
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
      status: response.status,
    });
  });

interface ProxyRead {
  readonly partial: aiTypes.AssistantMessage;
  readonly stream: aiTypes.AssistantMessageEventStream;
}

const readLine = ({ partial, stream }: ProxyRead, line: string) =>
  Effect.gen(function* () {
    if (!line.startsWith("data: ")) return false;
    const data = line.slice(6).trim();
    if (data === "") return false;
    const event = (yield* Effect.orDie(
      decodeJson(data),
    )) as proxyEventsTypes.ProxyAssistantMessageEvent;
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

const fail = (
  read: ProxyRead,
  message: string,
  status: number | undefined,
  aborted: boolean,
): void => {
  read.partial.stopReason = aborted ? "aborted" : "error";
  read.partial.errorMessage = message;
  if (status === undefined) delete read.partial.errorStatus;
  else read.partial.errorStatus = status;
  read.stream.push({ error: read.partial, reason: aborted ? "aborted" : "error", type: "error" });
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
        fail(
          read,
          "Connection closed by proxy server before the response completed",
          undefined,
          false,
        );
      }
    } else {
      const error = Cause.squash(exit.cause);
      fail(
        read,
        error instanceof Error ? error.message : String(error),
        error instanceof ProxyError ? error.status : undefined,
        signal?.aborted === true,
      );
    }
    read.stream.end();
  });

const streamProxy: {
  (
    context: aiTypes.TranscriptContext,
    options: proxyTypes.ProxyStreamOptions,
  ): (model: aiTypes.Model<any>) => aiTypes.AssistantMessageEventStream;
  (
    model: aiTypes.Model<any>,
    context: aiTypes.TranscriptContext,
    options: proxyTypes.ProxyStreamOptions,
  ): aiTypes.AssistantMessageEventStream;
} = Function.dual(
  3,
  (
    model: aiTypes.Model<any>,
    context: aiTypes.TranscriptContext,
    options: proxyTypes.ProxyStreamOptions,
  ): aiTypes.AssistantMessageEventStream => {
    const stream = createAssistantMessageEventStream();
    const read = { partial: initialPartial(model), stream };
    Effect.runFork(streamProxyEffect({ context, model, options }, read));
    return stream;
  },
);

const proxy = {
  streamProxy,
};

export default proxy;
