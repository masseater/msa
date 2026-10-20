import { zstdDecompressSync } from "node:zlib";

import { Effect, Stream } from "effect";
import { afterEach, vi } from "vite-plus/test";

import { stream as streamOpenAICodexResponses } from "../src/api/openai-codex-responses.ts";
import { closeOpenAICodexWebSocketSessions } from "../src/api/openai-codex-ws-cache.ts";
import { resetOpenAICodexWebSocketDebugStats } from "../src/api/openai-codex-ws-stats.ts";
import type { AssistantMessageEvent, Model, TranscriptContext } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

type CodexOptions = NonNullable<Parameters<typeof streamOpenAICodexResponses>[2]>;
type CodexStream = ReturnType<typeof streamOpenAICodexResponses>;

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";

const codexModel = (
  overrides: Partial<Model<"openai-codex-responses">> = {},
): Model<"openai-codex-responses"> => ({
  api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api",
  contextWindow: 400000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "codex-test",
  input: ["text"],
  maxTokens: 128000,
  name: "Codex Test",
  provider: "openai-codex",
  reasoning: true,
  ...overrides,
});

const promptContext = (content = "Say hello", timestamp = 1): TranscriptContext =>
  normalizeContext({
    messages: [{ content, role: "user", timestamp }],
    systemPrompt: "You are a helpful assistant.",
  });

const mockToken = (accountId = "acc_test") =>
  `aaa.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }), "utf8").toString("base64")}.bbb`;

const decodeCodexRequestBody = (body: RequestInit["body"] | undefined) => {
  if (typeof body === "string") return JSON.parse(body) as Record<string, unknown>;
  if (body instanceof Uint8Array) {
    return JSON.parse(Buffer.from(zstdDecompressSync(body)).toString("utf8")) as Record<
      string,
      unknown
    >;
  }
  return null;
};

const usage = (inputTokens: number, outputTokens: number) => ({
  input_tokens: inputTokens,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: outputTokens,
  total_tokens: inputTokens + outputTokens,
});

const helloMessage = (status: "completed" | "in_progress", text = "Hello") => ({
  content: status === "completed" ? [{ text, type: "output_text" }] : [],
  id: "msg_1",
  role: "assistant",
  status,
  type: "message",
});

const helloEvents = (terminal: object) => [
  { item: helloMessage("in_progress"), type: "response.output_item.added" },
  { part: { text: "", type: "output_text" }, type: "response.content_part.added" },
  { delta: "Hello", type: "response.output_text.delta" },
  { item: helloMessage("completed"), type: "response.output_item.done" },
  terminal,
];

const sseText = (events: readonly unknown[]) =>
  `${events.map((event) => (typeof event === "string" ? `data: ${event}` : `data: ${JSON.stringify(event)}`)).join("\n\n")}\n\n`;

const completedSse = (
  options: { endTurn?: boolean; includeDone?: boolean; status?: "completed" | "incomplete" } = {},
) => {
  const status = options.status ?? "completed";
  const terminal = {
    response: {
      end_turn: options.endTurn,
      incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
      status,
      usage: usage(5, 3),
    },
    type: status === "incomplete" ? "response.incomplete" : "response.completed",
  };
  return sseText([...helloEvents(terminal), ...(options.includeDone === true ? ["[DONE]"] : [])]);
};

const sseResponse = (body: string | ReadableStream<Uint8Array>) =>
  new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 });

const openSseBody = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
  });

interface CapturedRequest {
  readonly body: Record<string, unknown> | null;
  readonly headers: Headers | undefined;
  readonly rawBody: RequestInit["body"] | undefined;
}

const stubCodexFetch = (
  respond: (request: CapturedRequest, count: number) => Response = () =>
    sseResponse(completedSse()),
) => {
  const requests: CapturedRequest[] = [];
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url !== CODEX_URL) return Promise.reject(new Error(`Unexpected URL: ${url}`));
    const request = {
      body: decodeCodexRequestBody(init?.body),
      headers: init?.headers instanceof Headers ? init.headers : undefined,
      rawBody: init?.body ?? undefined,
    };
    requests.push(request);
    return Promise.resolve(respond(request, requests.length));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
};

const runCodex = (
  options: CodexOptions,
  request: {
    readonly context?: TranscriptContext;
    readonly model?: Model<"openai-codex-responses">;
  } = {},
) =>
  Effect.promise(() =>
    streamOpenAICodexResponses(request.model ?? codexModel(), request.context ?? promptContext(), {
      apiKey: mockToken(),
      transport: "sse",
      ...options,
    }).result(),
  );

const collectEvents = (
  stream: CodexStream,
  onEvent: (event: AssistantMessageEvent) => void = () => {},
) =>
  Effect.gen(function* () {
    const events: AssistantMessageEvent[] = [];
    yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
      Stream.orDie,
      Stream.runForEach((event) =>
        Effect.sync(() => {
          events.push(event);
          onEvent(event);
        }),
      ),
    );
    return { events, result: yield* Effect.promise(() => stream.result()) };
  });

const resetCodexStateAfterEach = () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    closeOpenAICodexWebSocketSessions();
    resetOpenAICodexWebSocketDebugStats();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
};

const openaiCodexStreamSupport = {
  CODEX_URL,
  codexModel,
  collectEvents,
  completedSse,
  decodeCodexRequestBody,
  helloEvents,
  mockToken,
  openSseBody,
  promptContext,
  resetCodexStateAfterEach,
  runCodex,
  sseResponse,
  sseText,
  stubCodexFetch,
  usage,
};

export default openaiCodexStreamSupport;
