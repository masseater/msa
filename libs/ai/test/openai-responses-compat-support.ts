import { Clock, Effect } from "effect";
import { vi } from "vite-plus/test";

import { stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import { normalizeContext } from "../src/compat.ts";
import type { Model, Tool } from "../src/types.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel, usesApi } = modelChoice;

type CapturedHeaders =
  | Headers
  | string[][]
  | Record<string, string | readonly string[]>
  | undefined;

interface CapturedResponsesPayload {
  readonly [field: string]: unknown;
  readonly max_output_tokens?: number;
  readonly prompt_cache_key?: string;
  readonly session_id?: string;
  readonly tools?: Array<{ readonly name?: string; readonly strict?: boolean }>;
}

const responsesModel = chooseModel("openai", "Responses", usesApi("openai-responses"));

function getHeader(headers: CapturedHeaders, name: string): string | null {
  if (headers === undefined) return null;
  if (headers instanceof Headers) return headers.get(name);
  const lowerName = name.toLowerCase();
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key?.toLowerCase() === lowerName)?.[1] ?? null;
  }
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName);
  if (entry === undefined) return null;
  return typeof entry[1] === "string" ? entry[1] : entry[1].join(", ");
}

const respondWith = (body: string) => {
  const headers = { value: undefined as CapturedHeaders };
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    headers.value = init?.headers;
    return Promise.resolve(
      new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 }),
    );
  });
  return headers;
};

const captureResponsesRequest = Effect.fn("captureResponsesRequest")(function* (
  options: Parameters<typeof streamOpenAIResponses>[2] = {},
  request: {
    readonly content?: string;
    readonly model?: Model<"openai-responses">;
    readonly tools?: Tool[];
  } = {},
) {
  const headers = respondWith("data: [DONE]\n\n");
  const captured: { payload?: CapturedResponsesPayload } = {};
  const timestamp = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() =>
    streamOpenAIResponses(
      request.model ?? responsesModel,
      normalizeContext({
        messages: [{ content: request.content ?? "hi", role: "user", timestamp }],
        systemPrompt: "sys",
        ...(request.tools === undefined ? {} : { tools: request.tools }),
      }),
      {
        apiKey: "sk-test-key",
        ...options,
        onPayload: (payload) => {
          captured.payload = payload as CapturedResponsesPayload;
        },
      },
    ).result(),
  );
  return {
    clientRequestId: getHeader(headers.value, "x-client-request-id"),
    payload: captured.payload,
    sessionId: getHeader(headers.value, "session_id"),
    xSessionId: getHeader(headers.value, "x-session-id"),
  };
});

const proxyModel = (
  provider: string,
  compat?: Model<"openai-responses">["compat"],
  baseUrl = "https://proxy.example.com/v1",
): Model<"openai-responses"> => ({
  ...responsesModel,
  baseUrl,
  provider,
  ...(compat === undefined ? {} : { compat }),
});

const openaiResponsesCompatSupport = {
  captureResponsesRequest,
  proxyModel,
  respondWith,
  responsesModel,
};

export default openaiResponsesCompatSupport;
