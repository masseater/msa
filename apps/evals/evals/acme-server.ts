import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Context, Effect, Exit, Layer, Option, Schema, Scope } from "effect";
import { HttpEffect, HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

export const OPENAI_PROVIDER_ID = "acme";
export const OPENAI_MODEL_ID = "acme-chat";
export const OPENAI_PROBE_PROMPT = "Reply with ACME_OK.";
export const OPENAI_PROBE_RESPONSE = "ACME_OK";
export const STREAM_PROVIDER_ID = "acme-stream";
export const STREAM_MODEL_ID = "acme-stream-chat";
export const STREAM_PROBE_PROMPT = "Reply with ACME_STREAM_OK.";
export const STREAM_PROBE_RESPONSE = "ACME_STREAM_OK";

export const STREAM_API_DOCUMENTATION = `${JSON.stringify(
  {
    name: "Acme Streaming API",
    request: {
      body: {
        messages: [{ role: "user", content: "Hello" }],
        model: STREAM_MODEL_ID,
        stream: true,
      },
      headers: { "content-type": "application/json", "x-acme-key": "resolved credential" },
      method: "POST",
      path: "/generate",
    },
    response: {
      contentType: "application/x-ndjson",
      events: [
        { text: "Hello", type: "text_delta" },
        { input_tokens: 3, output_tokens: 2, type: "usage" },
        { reason: "stop", type: "done" },
      ],
    },
  },
  null,
  2,
)}\n`;

type ServerMode = "openai" | "stream";

type Probe = { validRequestReceived: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectRequest(status: number, message: string): Response {
  return new Response(message, { headers: { "content-type": "text/plain" }, status });
}

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

const readJson = (request: Request): Effect.Effect<Option.Option<unknown>> =>
  Effect.promise(() => request.text()).pipe(
    Effect.flatMap((body) => Effect.option(decodeJson(body))),
  );

function firstUserPrompt(payload: Record<string, unknown>): string | undefined {
  const messages = Array.isArray(payload["messages"]) ? payload["messages"] : [];
  const userMessage = messages.find(
    (message): message is Record<string, unknown> =>
      isRecord(message) && message["role"] === "user",
  );
  const content = userMessage?.["content"];
  return typeof content === "string" ? content : undefined;
}

const lines = (events: readonly unknown[]): string =>
  events.map((event) => `${JSON.stringify(event)}\n`).join("");

function streamResponse(
  request: Request,
  payload: Record<string, unknown>,
  prompt: string | undefined,
  probe: Probe,
): Response {
  if (request.headers.get("x-acme-key") !== "resolved-stream-key") {
    return rejectRequest(401, "Invalid Acme Stream credential");
  }
  if (payload["model"] !== STREAM_MODEL_ID || prompt === undefined || payload["stream"] !== true) {
    return rejectRequest(422, "Invalid Acme Stream request");
  }
  probe.validRequestReceived = prompt === STREAM_PROBE_PROMPT;
  return new Response(
    lines([
      { text: "ACME_", type: "text_delta" },
      { text: "STREAM_OK", type: "text_delta" },
      { input_tokens: 4, output_tokens: 3, type: "usage" },
      { reason: "stop", type: "done" },
    ]),
    { headers: { "content-type": "application/x-ndjson" }, status: 200 },
  );
}

const chunk = (fields: Record<string, unknown>): string =>
  `data: ${JSON.stringify({
    created: 0,
    id: "chatcmpl-acme",
    model: OPENAI_MODEL_ID,
    object: "chat.completion.chunk",
    ...fields,
  })}\n\n`;

function openAiResponse(
  request: Request,
  payload: Record<string, unknown>,
  prompt: string | undefined,
  probe: Probe,
): Response {
  if (request.headers.get("authorization") !== "Bearer resolved-acme-key") {
    return rejectRequest(401, "Invalid Acme credential");
  }
  if (payload["model"] !== OPENAI_MODEL_ID || prompt === undefined || payload["stream"] !== true) {
    return rejectRequest(422, "Invalid OpenAI-compatible request");
  }
  probe.validRequestReceived = prompt === OPENAI_PROBE_PROMPT;
  const body =
    chunk({
      choices: [
        {
          delta: { content: OPENAI_PROBE_RESPONSE, role: "assistant" },
          finish_reason: null,
          index: 0,
        },
      ],
    }) +
    chunk({
      choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
      usage: { completion_tokens: 2, prompt_tokens: 3 },
    }) +
    "data: [DONE]\n\n";
  return new Response(body, {
    headers: { "cache-control": "no-cache", "content-type": "text/event-stream" },
    status: 200,
  });
}

const handle =
  (mode: ServerMode, probe: Probe) =>
  (request: Request): Effect.Effect<Response> =>
    Effect.gen(function* () {
      const { pathname, search } = new URL(request.url);
      const expectedPath = mode === "openai" ? "/v1/chat/completions" : "/generate";
      if (`${pathname}${search}` !== expectedPath) return rejectRequest(404, "Unknown endpoint");
      if (request.method !== "POST") return rejectRequest(405, "Expected POST");
      if (request.headers.get("content-type")?.startsWith("application/json") !== true) {
        return rejectRequest(415, "Expected application/json");
      }
      const payload = yield* readJson(request);
      if (Option.isNone(payload)) return rejectRequest(400, "Invalid JSON");
      if (!isRecord(payload.value)) return rejectRequest(422, "Expected a JSON object");
      const prompt = firstUserPrompt(payload.value);
      return mode === "stream"
        ? streamResponse(request, payload.value, prompt, probe)
        : openAiResponse(request, payload.value, prompt, probe);
    });

const webHandler = (mode: ServerMode, probe: Probe) =>
  HttpEffect.fromWebHandler((request) => Effect.runPromise(handle(mode, probe)(request)));

export type AcmeServer = {
  start: Effect.Effect<void>;
  stop: Effect.Effect<void>;
  reset(): void;
  origin(): string;
  baseUrl(): string;
  validRequestReceived(): boolean;
};

export function createAcmeServer(mode: ServerMode): AcmeServer {
  const probe: Probe = { validRequestReceived: false };
  let scope: Scope.Closeable | undefined;
  let serverOrigin = "";

  const start = Effect.gen(function* () {
    const serverScope = yield* Scope.make();
    const serving = HttpServer.serve(webHandler(mode, probe)).pipe(
      Layer.provideMerge(NodeHttpServer.layerTest),
    );
    const services = yield* Layer.buildWithScope(serving, serverScope).pipe(Effect.orDie);
    const { address } = Context.get(services, HttpServer.HttpServer);
    if (NetAddress.isUnixPathAddress(address)) {
      return yield* Effect.die(new Error("Acme fixture server did not bind a TCP port."));
    }
    scope = serverScope;
    serverOrigin = `http://127.0.0.1:${address.port}`;
  });

  const stop = Effect.suspend(() => {
    const closing = scope;
    scope = undefined;
    return closing === undefined ? Effect.void : Scope.close(closing, Exit.void);
  });

  return {
    baseUrl: () => `${serverOrigin}/v1`,
    origin: () => serverOrigin,
    reset() {
      probe.validRequestReceived = false;
    },
    start,
    stop,
    validRequestReceived: () => probe.validRequestReceived,
  };
}
