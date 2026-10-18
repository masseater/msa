import { Effect } from "effect";
import type OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type { Api, AssistantMessage, Model, StreamOptions } from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { callHook } from "../utils/hooks.ts";
import { providerRequestWithRetry } from "../utils/provider-retry.ts";
import type { OpenAIResponsesStreamOptions } from "./openai-responses-options.ts";
import { processResponsesStream } from "./openai-responses-stream.ts";

export interface ResponsesRequest {
  readonly client: Pick<OpenAI, "responses">;
  readonly params: ResponseCreateParamsStreaming;
  readonly streamOptions: OpenAIResponsesStreamOptions;
}

export interface ResponsesRunSpec<TApi extends Api> {
  readonly model: Model<TApi>;
  readonly options: StreamOptions | undefined;
  readonly output: AssistantMessage;
  readonly streamName: string;
  readonly prepare: () => ResponsesRequest;
  readonly formatError: (error: unknown) => string;
}

function finish(
  { output, options, streamName }: ResponsesRunSpec<Api>,
  events: AssistantMessageEventStream,
): void {
  if (options?.signal?.aborted === true) throw new Error("Request was aborted");
  if (output.stopReason === "pending") {
    throw new Error(`${streamName} stream ended without a stop reason`);
  }
  if (output.stopReason === "aborted" || output.stopReason === "error") {
    throw new Error(output.errorMessage || "An unknown error occurred");
  }
  events.push({ type: "done", reason: output.stopReason, message: output });
  events.end();
}

function fail(
  { output, options, formatError }: ResponsesRunSpec<Api>,
  events: AssistantMessageEventStream,
  error: unknown,
): void {
  for (const block of output.content) {
    delete (block as { index?: number }).index;
    delete (block as { partialJson?: string }).partialJson;
    delete (block as { customInput?: unknown }).customInput;
  }
  output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
  output.errorMessage = formatError(error);
  events.push({ type: "error", reason: output.stopReason, error: output });
  events.end();
}

const request = Effect.fn("openaiResponsesRequest")(function* (
  spec: ResponsesRunSpec<Api>,
  events: AssistantMessageEventStream,
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
  const head = { status: response.status, headers: headersToRecord(response.headers) };
  yield* callHook(() => options?.onResponse?.(head, model));
  events.push({ type: "start", partial: output });
  yield* processResponsesStream(openaiStream, output, events, model, streamOptions);
  finish(spec, events);
});

export function runResponsesStream<TApi extends Api>(
  spec: ResponsesRunSpec<TApi>,
): AssistantMessageEventStream {
  const events = new AssistantMessageEventStream();
  Effect.runFork(
    request(spec, events).pipe(
      Effect.catchDefect((error) => Effect.sync(() => fail(spec, events, error))),
    ),
  );
  return events;
}
