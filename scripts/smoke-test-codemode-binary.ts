import { NodeHttpServer } from "@effect/platform-node";
import { Console, Data, Effect, Option, Ref, Schema } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { NetAddress } from "effect/net";

import { Host, runScriptWith } from "./host.ts";
import type { HostShape } from "./host.ts";

const WORKER_MARKER = "MSA_CODEMODE_WORKER_OK";
const SUCCESS_MARKER = "MSA_CODEMODE_BINARY_SMOKE_OK";
const FAILURE_MARKER = "MSA_CODEMODE_BINARY_SMOKE_FAILED";
const TIMEOUT_MS = 30_000;

class SmokeError extends Data.TaggedError("SmokeError")<{ readonly message: string }> {}

interface Usage {
  readonly completion_tokens: number;
  readonly prompt_tokens: number;
}

interface Delta {
  readonly content?: string;
  readonly role?: string;
  readonly tool_calls?: ReadonlyArray<unknown>;
}

const ChunkJson = Schema.fromJsonString(Schema.Unknown);
const encodeChunk = Schema.encodeEffect(ChunkJson);

const RequestBody = Schema.fromJsonString(
  Schema.Struct({
    messages: Schema.optional(
      Schema.Array(
        Schema.Struct({
          role: Schema.optional(Schema.String),
          content: Schema.optional(Schema.Unknown),
        }),
      ),
    ),
  }),
);

const completionChunk = (options: {
  readonly delta: Delta;
  readonly finishReason: string | null;
  readonly id: string;
  readonly usage?: Usage;
}): Record<string, unknown> => ({
  id: options.id,
  object: "chat.completion.chunk",
  created: 0,
  model: "codemode-smoke",
  choices: [{ index: 0, delta: options.delta, finish_reason: options.finishReason }],
  ...(options.usage === undefined ? {} : { usage: options.usage }),
});

const sseBody = (chunks: ReadonlyArray<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const encoded = yield* Effect.forEach(chunks, (chunk) => encodeChunk(chunk));
    return `${encoded.map((chunk) => `data: ${chunk}\n\n`).join("")}data: [DONE]\n\n`;
  });

const sseResponse = (chunks: ReadonlyArray<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const body = yield* sseBody(chunks);
    return HttpServerResponse.text(body, {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", connection: "close" },
    });
  });

const toolResultContainsMarker = (body: string) =>
  Effect.gen(function* () {
    const parsed = yield* Schema.decodeEffect(RequestBody)(body).pipe(Effect.option);
    if (Option.isNone(parsed)) return false;
    const toolMessages = (parsed.value.messages ?? []).filter((message) => message.role === "tool");
    const encoded = yield* Effect.forEach(toolMessages, (message) =>
      encodeChunk(message.content).pipe(Effect.orElseSucceed(() => "")),
    );
    return encoded.some((content) => content.includes(WORKER_MARKER));
  });

const firstTurnChunks = (id: string): ReadonlyArray<Record<string, unknown>> => [
  completionChunk({
    id,
    finishReason: null,
    delta: {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "call_codemode_smoke",
          type: "function",
          function: { name: "codemode", arguments: `{"code":"text(\\"${WORKER_MARKER}\\")"}` },
        },
      ],
    },
  }),
  completionChunk({
    id,
    finishReason: "tool_calls",
    delta: {},
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }),
];

const secondTurnChunks = (id: string, marker: string): ReadonlyArray<Record<string, unknown>> => [
  completionChunk({ id, finishReason: null, delta: { role: "assistant", content: marker } }),
  completionChunk({
    id,
    finishReason: "stop",
    delta: {},
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }),
];

const handler = (requestCount: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== "POST" || !request.url.endsWith("/chat/completions")) {
      return HttpServerResponse.empty({ status: 404 });
    }
    const body = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
    const count = yield* Ref.updateAndGet(requestCount, (value) => value + 1);
    const id = `chatcmpl-codemode-smoke-${count}`;
    if (count === 1) return yield* sseResponse(firstTurnChunks(id));
    const marker = (yield* toolResultContainsMarker(body)) ? SUCCESS_MARKER : FAILURE_MARKER;
    return yield* sseResponse(secondTurnChunks(id, marker));
  }).pipe(Effect.orDie);

const modelsConfig = (port: number) =>
  encodeChunk({
    providers: {
      "codemode-smoke": {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        api: "openai-completions",
        apiKey: "smoke-test",
        models: [{ id: "codemode-smoke" }],
      },
    },
  });

const MSA_ARGS: ReadonlyArray<string> = [
  "--provider",
  "codemode-smoke",
  "--model",
  "codemode-smoke",
  "--tools",
  "codemode",
  "--print",
  "--no-session",
  "--offline",
  "--no-context-files",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "Run the codemode binary smoke test.",
];

const runBinary = (options: {
  readonly binary: string;
  readonly host: HostShape;
  readonly tempDir: string;
}) =>
  Effect.gen(function* () {
    const { binary, host, tempDir } = options;
    const isJavaScript = host.extname(binary) === ".js";
    return yield* host
      .run({
        args: isJavaScript ? [binary, ...MSA_ARGS] : [...MSA_ARGS],
        command: isJavaScript ? process.execPath : binary,
        cwd: tempDir,
        env: { MSA_CODING_AGENT_DIR: tempDir, MSA_OFFLINE: "1" },
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
      })
      .pipe(
        Effect.timeoutOrElse({
          duration: TIMEOUT_MS,
          orElse: () => new SmokeError({ message: `Smoke test timed out after ${TIMEOUT_MS} ms` }),
        }),
      );
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const binaryArg = process.argv[2];
  if (binaryArg === undefined || process.argv.length !== 3) {
    return yield* new SmokeError({
      message: "Usage: node scripts/smoke-test-codemode-binary.ts <msa-binary>",
    });
  }
  const binary = host.resolve(binaryArg);
  const tempDir = yield* host.makeTempDirectory("msa-codemode-binary-smoke-");
  const requestCount = yield* Ref.make(0);
  const server = yield* HttpServer.HttpServer;
  const address = server.address;
  if (!NetAddress.isInetAddress(address)) {
    return yield* new SmokeError({ message: "Smoke-test server did not bind to a TCP port" });
  }
  yield* server.serve(handler(requestCount));
  yield* Effect.ensuring(
    Effect.gen(function* () {
      yield* host.writeText(host.join(tempDir, "models.json"), yield* modelsConfig(address.port));
      const result = yield* runBinary({ binary, host, tempDir });
      const count = yield* Ref.get(requestCount);
      if (result.exitCode !== 0 || !result.stdout.includes(SUCCESS_MARKER) || count < 2) {
        return yield* new SmokeError({
          message: `Codemode binary smoke test failed (exit ${result.exitCode}, requests ${count})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        });
      }
      yield* Effect.sync(() => process.stdout.write(result.stdout));
    }),
    host.remove(tempDir),
  );
}).pipe(
  Effect.catchTag("SmokeError", (error) =>
    Effect.gen(function* () {
      yield* Console.error(error.message);
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    }),
  ),
  Effect.scoped,
);

runScriptWith(NodeHttpServer.layerTest)(program);
