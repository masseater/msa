import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, Exit, Layer, ManagedRuntime, Schedule, Scope, Stream } from "effect";
import { HttpClient, type HttpClientResponse } from "effect/http";
import { ChildProcess } from "effect/process";

import type typesModule from "../src/types.types.ts";

const { localLlmTests } = testing;

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici));

const OLLAMA_MODEL = "gpt-oss:20b";

const ollamaModel: typesModule.Model<"openai-completions"> = {
  api: "openai-completions",
  baseUrl: "http://localhost:11434/v1",
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: OLLAMA_MODEL,
  input: ["text"],
  maxTokens: 16000,
  name: "Ollama GPT-OSS 20B",
  provider: "ollama",
  reasoning: true,
};

const localModel = (
  provider: string,
  baseUrl: string,
  contextWindow: number,
): typesModule.Model<"openai-completions"> => ({
  api: "openai-completions",
  baseUrl,
  contextWindow,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "local-model",
  input: ["text"],
  maxTokens: 2048,
  name: `${provider} Local Model`,
  provider,
  reasoning: false,
});

const lmStudioModel = localModel("lm-studio", "http://localhost:1234/v1", 8192);
const llamaCppModel = localModel("llama.cpp", "http://localhost:8081/v1", 4096);

const commandOutput = (command: string, args: string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, args, {
        stderr: "ignore",
        stdin: "ignore",
        stdout: "pipe",
      });
      const stdout = yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString);
      return (yield* handle.exitCode) === 0 ? stdout : undefined;
    }),
  ).pipe(Effect.orElseSucceed(() => undefined));

const statusOf = <E, R>(request: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>) =>
  request.pipe(
    Effect.map((response) => response.status),
    Effect.timeout("1 second"),
    Effect.orElseSucceed(() => 0),
  );

const llamaCppCompletionStatus = commandOutput("curl", [
  "-s",
  "--max-time",
  "1",
  "-o",
  "/dev/null",
  "-w",
  "%{http_code}",
  "-X",
  "POST",
  "http://localhost:8081/v1/completions",
  "-H",
  "content-type: application/json",
  "-d",
  '{"model":"local-model","prompt":"ping","max_tokens":1}',
]).pipe(Effect.map((status) => Number(status ?? 0)));

const probeLocalLlms = Effect.gen(function* () {
  if (!localLlmTests) return { llamaCpp: false, lmStudio: false, ollama: false };
  const [ollama, lmStudio, llamaHealth, llamaCompletions] = yield* Effect.all(
    [
      commandOutput("ollama", ["--version"]),
      statusOf(HttpClient.get("http://localhost:1234/v1/models")),
      statusOf(HttpClient.get("http://localhost:8081/health")),
      llamaCppCompletionStatus,
    ],
    { concurrency: "unbounded" },
  );
  return {
    llamaCpp: llamaHealth === 200 && ![0, 404, 405].includes(llamaCompletions),
    lmStudio: lmStudio === 200,
    ollama: ollama !== undefined,
  };
});

const ensureOllamaModel = Effect.gen(function* () {
  const listed = yield* commandOutput("ollama", ["list"]);
  if (listed?.includes(OLLAMA_MODEL) === true) return;
  yield* commandOutput("ollama", ["pull", OLLAMA_MODEL]);
});

const waitForOllama = HttpClient.get("http://localhost:11434/api/tags").pipe(
  Effect.flatMap((response) => (response.status === 200 ? Effect.void : Effect.fail("not ready"))),
  Effect.retry(Schedule.spaced("500 millis")),
  Effect.timeout("60 seconds"),
);

const startOllama = (): Promise<() => Promise<void>> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      yield* ensureOllamaModel;
      yield* Scope.provide(scope)(
        ChildProcess.make("ollama", ["serve"], {
          stderr: "ignore",
          stdin: "ignore",
          stdout: "ignore",
        }),
      );
      yield* Effect.orDie(waitForOllama);
      return () => runtime.runPromise(Scope.close(scope, Exit.void));
    }),
  );

const localLlmSupport = {
  llamaCppModel,
  lmStudioModel,
  ollamaModel,
  probeLocalLlms: () => runtime.runPromise(probeLocalLlms),
  startOllama,
};

export default localLlmSupport;
