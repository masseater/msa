import { NodeServices } from "@effect/platform-node";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import codingAgent from "@msa/coding-agent";
import {
  Clock,
  Console,
  Effect,
  FileSystem,
  ManagedRuntime,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";

import config from "./config.ts";
import streamModule from "./stream.ts";

const { getAgentDir } = codingAgent;
const { MODELS } = config;
const { streamGitLabDuo } = streamModule;

const { registerApiProvider, streamSimple } = compat;

const runtime = ManagedRuntime.make(NodeServices.layer);
const pathService = runtime.runSync(Path.Path);
const fsService = runtime.runSync(FileSystem.FileSystem);

const MODEL_MAP = new Map(MODELS.map((m) => [m.id, m]));

const AuthSchema = Schema.Struct({
  access: Schema.String,
});

const GitLabAuthSchema = Schema.Record(Schema.String, AuthSchema);

class TestError extends Schema.TaggedError<TestError, { readonly brand: unique symbol }>()(
  "TestError",
  { message: Schema.String },
) {}

const readGitLabAccess = Effect.gen(function* () {
  const authPath = pathService.join(getAgentDir(), "extensions", "auth.json");
  const content = yield* fsService.readFileString(authPath).pipe(Effect.option);
  if (Option.isNone(content)) {
    return yield* TestError.make({
      message: "No gitlab-duo credentials. Run /login gitlab-duo first.",
    });
  }

  const parsed = Schema.decodeOption(Schema.fromJsonString(GitLabAuthSchema))(content.value);
  const access = Option.isSome(parsed) ? parsed.value["gitlab-duo"]?.access : undefined;
  if (access === undefined || access.length === 0) {
    return yield* TestError.make({
      message: "No gitlab-duo credentials. Run /login gitlab-duo first.",
    });
  }
  return access;
});

const buildModel = (cfg: (typeof MODELS)[number]): compatTypes.Model<compatTypes.Api> => ({
  api: "gitlab-duo-api" as compatTypes.Api,
  baseUrl: cfg.baseUrl,
  contextWindow: cfg.contextWindow,
  cost: cfg.cost,
  id: cfg.id,
  input: cfg.input,
  maxTokens: cfg.maxTokens,
  name: cfg.name,
  provider: "gitlab-duo",
  reasoning: cfg.reasoning,
});

interface ProviderEvent {
  readonly type: string;
  readonly delta?: string;
  readonly error?: { readonly errorMessage: string };
  readonly reason?: string;
  readonly message?: { readonly usage: unknown };
}

const printEvent = (event: ProviderEvent): void => {
  switch (event.type) {
    case "thinking_start":
      Effect.runSync(Console.log("[Thinking]"));
      return;
    case "thinking_delta":
      process.stdout.write(event.delta ?? "");
      return;
    case "thinking_end":
      Effect.runSync(Console.log("\n[/Thinking]\n"));
      return;
    case "text_delta":
      process.stdout.write(event.delta ?? "");
      return;
    case "error":
      Effect.runSync(Console.error("\nError:", event.error?.errorMessage ?? ""));
      return;
    case "done":
      Effect.runSync(Console.log("\n\nDone!", event.reason, event.message?.usage));
  }
};

const runTest = Effect.gen(function* () {
  const modelId = process.argv[2] || "claude-sonnet-4-5-20250929";
  const useThinking = process.argv.includes("--thinking");

  const cfg = MODEL_MAP.get(modelId);
  if (cfg === undefined) {
    yield* Console.error(`Unknown model: ${modelId}`);
    yield* Console.error("Available:", MODELS.map((m) => m.id).join(", "));
    return;
  }

  const gitlabAccess = yield* readGitLabAccess;

  registerApiProvider({
    api: "gitlab-duo-api" as compatTypes.Api,
    stream: streamGitLabDuo,
    streamSimple: streamGitLabDuo,
  });

  const model = buildModel(cfg);
  const context: compatTypes.Context = {
    messages: [
      {
        content: "Say hello in exactly 3 words.",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  yield* Console.log(`Model: ${model.id}, Backend: ${cfg.backend}, Thinking: ${useThinking}`);

  const stream = streamSimple(model, context, {
    apiKey: gitlabAccess,
    maxTokens: 100,
    reasoning: useThinking ? "low" : undefined,
  });

  yield* Stream.runForEach(
    Stream.fromAsyncIterable(stream, (error) => TestError.make({ message: String(error) })),
    (event) => Effect.sync(() => printEvent(event as ProviderEvent)),
  );
});

void runtime.runPromise(runTest).catch((error: unknown) => {
  Effect.runSync(Console.error(Schema.is(TestError)(error) ? error.message : String(error)));
});
