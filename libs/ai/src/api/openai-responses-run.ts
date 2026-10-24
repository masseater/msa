import { Effect } from "effect";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import eventStream from "../utils/event-stream.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import headersModule from "../utils/headers.ts";
import hooks from "../utils/hooks.ts";
import providerRetry from "../utils/provider-retry.ts";
import type openaiResponsesRunTypes from "./openai-responses-run.types.ts";
import openaiResponsesStream from "./openai-responses-stream.ts";

const { callHook } = hooks;
const { providerRequestWithRetry } = providerRetry;
const { headersToRecord } = headersModule;
const { processResponsesStream } = openaiResponsesStream;
const { AssistantMessageEventStream } = eventStream;

function finish(
  { output, options, streamName }: openaiResponsesRunTypes.ResponsesRunSpec<typesModule.Api>,
  events: eventStreamTypes.AssistantMessageEventStream,
): void {
  if (options?.signal?.aborted === true) throw new Error("Request was aborted");
  if (output.stopReason === "pending") {
    throw new Error(`${streamName} stream ended without a stop reason`);
  }
  if (output.stopReason === "aborted" || output.stopReason === "error") {
    throw new Error(output.errorMessage || "An unknown error occurred");
  }
  events.push({ message: output, reason: output.stopReason, type: "done" });
  events.end();
}

function fail(
  { output, options, recordError }: openaiResponsesRunTypes.ResponsesRunSpec<typesModule.Api>,
  events: eventStreamTypes.AssistantMessageEventStream,
  error: unknown,
): void {
  for (const block of output.content) {
    delete (block as { index?: number }).index;
    delete (block as { partialJson?: string }).partialJson;
    delete (block as { customInput?: unknown }).customInput;
  }
  output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
  recordError(output, error);
  events.push({ error: output, reason: output.stopReason, type: "error" });
  events.end();
}

const request = Effect.fn("openaiResponsesRequest")(function* (
  spec: openaiResponsesRunTypes.ResponsesRunSpec<typesModule.Api>,
  events: eventStreamTypes.AssistantMessageEventStream,
) {
  const { model, options, output } = spec;
  const { client, params: prepared, streamOptions } = spec.prepare();
  const nextParams = yield* callHook(() => options?.onPayload?.(prepared, model));
  const params = (nextParams ?? prepared) as ResponseCreateParamsStreaming;
  const requestOptions = {
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    maxRetries: 0,
  };
  const { data: openaiStream, response } = yield* providerRequestWithRetry(
    () => client.responses.create(params, requestOptions).withResponse(),
    {
      maxRetries: options?.maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      signal: options?.signal,
    },
  );
  const head = { headers: headersToRecord(response.headers), status: response.status };
  yield* callHook(() => options?.onResponse?.(head, model));
  events.push({ partial: output, type: "start" });
  yield* processResponsesStream(openaiStream, output, events, model, streamOptions);
  finish(spec, events);
});

function runResponsesStream<TApi extends typesModule.Api>(
  spec: openaiResponsesRunTypes.ResponsesRunSpec<TApi>,
): eventStreamTypes.AssistantMessageEventStream {
  const events = new AssistantMessageEventStream();
  Effect.runFork(
    request(spec, events).pipe(
      Effect.catchDefect((error) => Effect.sync(() => fail(spec, events, error))),
    ),
  );
  return events;
}

const openaiResponsesRun = {
  runResponsesStream,
};

export default openaiResponsesRun;
