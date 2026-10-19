import { Effect, ManagedRuntime, Schema } from "effect";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  type AcmeServer,
  createAcmeServer,
  OPENAI_MODEL_ID,
  OPENAI_PROBE_PROMPT,
  OPENAI_PROBE_RESPONSE,
  STREAM_MODEL_ID,
  STREAM_PROBE_PROMPT,
  STREAM_PROBE_RESPONSE,
} from "../evals/acme-server.ts";

type Fixture = {
  mode: "openai" | "stream";
  url: (server: AcmeServer) => string;
  headers: Record<string, string>;
  unauthorizedHeaders: Record<string, string>;
  model: string;
  prompt: string;
  response: string;
  contentType: string;
  unauthorized: string;
  invalid: string;
};

const fixtures: Fixture[] = [
  {
    mode: "openai",
    url: (server) => `${server.baseUrl()}/chat/completions`,
    headers: { authorization: "Bearer resolved-acme-key" },
    unauthorizedHeaders: { authorization: "Bearer wrong-key" },
    model: OPENAI_MODEL_ID,
    prompt: OPENAI_PROBE_PROMPT,
    response: OPENAI_PROBE_RESPONSE,
    contentType: "text/event-stream",
    unauthorized: "Invalid Acme credential",
    invalid: "Invalid OpenAI-compatible request",
  },
  {
    mode: "stream",
    url: (server) => `${server.origin()}/generate`,
    headers: { "x-acme-key": "resolved-stream-key" },
    unauthorizedHeaders: { "x-acme-key": "wrong-key" },
    model: STREAM_MODEL_ID,
    prompt: STREAM_PROBE_PROMPT,
    response: STREAM_PROBE_RESPONSE,
    contentType: "application/x-ndjson",
    unauthorized: "Invalid Acme Stream credential",
    invalid: "Invalid Acme Stream request",
  },
];

function body(model: string, prompt: string, stream = true) {
  return { model, messages: [{ role: "user", content: prompt }], stream };
}

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const httpRuntime = ManagedRuntime.make(FetchHttpClient.layer);

type Reply = { status: number; contentType: string | undefined; text: string };

const post = (
  url: string,
  headers: Record<string, string>,
  payload: unknown,
): Effect.Effect<Reply> =>
  Effect.promise(() =>
    httpRuntime.runPromise(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const text = yield* encodeJson(payload);
        const request = HttpClientRequest.post(url).pipe(
          HttpClientRequest.setHeaders({ "content-type": "application/json", ...headers }),
          HttpClientRequest.setBody(HttpBody.raw(text, { contentType: "application/json" })),
        );
        const response = yield* client.execute(request);
        return {
          status: response.status,
          contentType: response.headers["content-type"],
          text: yield* response.text,
        };
      }).pipe(Effect.orDie),
    ),
  );

function streamedText(mode: Fixture["mode"], raw: string): string {
  if (mode === "stream") {
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; text?: string })
      .filter((event) => event.type === "text_delta")
      .map((event) => event.text ?? "")
      .join("");
  }
  return raw
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map(
      (line) =>
        JSON.parse(line.slice("data: ".length)) as {
          choices?: Array<{ delta?: { content?: string } }>;
        },
    )
    .map((chunk) => chunk.choices?.[0]?.delta?.content ?? "")
    .join("");
}

const run = (effect: Effect.Effect<void>) => Effect.runPromise(effect);

function acceptanceTests(fixture: Fixture, server: AcmeServer) {
  it("accepts the probe request and records it", () =>
    run(
      Effect.gen(function* () {
        const response = yield* post(
          fixture.url(server),
          fixture.headers,
          body(fixture.model, fixture.prompt),
        );
        expect(response.status).toBe(200);
        expect(response.contentType).toContain(fixture.contentType);
        expect(streamedText(fixture.mode, response.text)).toBe(fixture.response);
        expect(server.validRequestReceived()).toBe(true);
      }),
    ));

  it("does not treat a non-probe success as the probe", () =>
    run(
      Effect.gen(function* () {
        const response = yield* post(
          fixture.url(server),
          fixture.headers,
          body(fixture.model, "hello"),
        );
        expect(response.status).toBe(200);
        expect(server.validRequestReceived()).toBe(false);
      }),
    ));

  it("clears the probe flag on reset", () =>
    run(
      Effect.gen(function* () {
        yield* post(fixture.url(server), fixture.headers, body(fixture.model, fixture.prompt));
        expect(server.validRequestReceived()).toBe(true);
        server.reset();
        expect(server.validRequestReceived()).toBe(false);
      }),
    ));
}

function rejectionTests(fixture: Fixture, server: AcmeServer) {
  it("rejects a bad credential with 401 and does not record a probe", () =>
    run(
      Effect.gen(function* () {
        const response = yield* post(
          fixture.url(server),
          fixture.unauthorizedHeaders,
          body(fixture.model, fixture.prompt),
        );
        expect(response.status).toBe(401);
        expect(response.text).toBe(fixture.unauthorized);
        expect(server.validRequestReceived()).toBe(false);
      }),
    ));

  it("rejects a malformed request with 422 and does not record a probe", () =>
    run(
      Effect.gen(function* () {
        const response = yield* post(
          fixture.url(server),
          fixture.headers,
          body(fixture.model, fixture.prompt, false),
        );
        expect(response.status).toBe(422);
        expect(response.text).toBe(fixture.invalid);
        expect(server.validRequestReceived()).toBe(false);
      }),
    ));
}

describe.each(fixtures)("$mode fixture", (fixture) => {
  const server = createAcmeServer(fixture.mode);

  beforeAll(() => Effect.runPromise(server.start));
  beforeEach(() => server.reset());
  afterAll(() => Effect.runPromise(server.stop));

  acceptanceTests(fixture, server);
  rejectionTests(fixture, server);
});
