import { NodeServices } from "@effect/platform-node";
import {
  type Api,
  type Context,
  type Model,
  registerApiProvider,
  streamSimple,
} from "@msa/ai/compat";
import { getAgentDir } from "@msa/coding-agent";
import {
  Clock,
  Console,
  Data,
  Effect,
  FileSystem,
  ManagedRuntime,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";

import { MODELS, streamGitLabDuo } from "./index.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const pathService = runtime.runSync(Path.Path);
const fsService = runtime.runSync(FileSystem.FileSystem);

const MODEL_MAP = new Map(MODELS.map((m) => [m.id, m]));

const AuthSchema = Schema.Struct({
  access: Schema.String,
});

const GitLabAuthSchema = Schema.Record(Schema.String, AuthSchema);

class TestError extends Data.TaggedError("TestError")<{ readonly message: string }> {}

const readGitLabAccess = Effect.gen(function* () {
  const authPath = pathService.join(getAgentDir(), "extensions", "auth.json");
  const content = yield* fsService.readFileString(authPath).pipe(Effect.option);
  if (Option.isNone(content)) {
    return yield* new TestError({
      message: "No gitlab-duo credentials. Run /login gitlab-duo first.",
    });
  }

  const parsed = Schema.decodeOption(Schema.fromJsonString(GitLabAuthSchema))(content.value);
  const access = Option.isSome(parsed) ? parsed.value["gitlab-duo"]?.access : undefined;
  if (access === undefined || access.length === 0) {
    return yield* new TestError({
      message: "No gitlab-duo credentials. Run /login gitlab-duo first.",
    });
  }
  return access;
});

const buildModel = (cfg: (typeof MODELS)[number]): Model<Api> => ({
  id: cfg.id,
  name: cfg.name,
  api: "gitlab-duo-api" as Api,
  provider: "gitlab-duo",
  baseUrl: cfg.baseUrl,
  reasoning: cfg.reasoning,
  input: cfg.input,
  cost: cfg.cost,
  contextWindow: cfg.contextWindow,
  maxTokens: cfg.maxTokens,
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
    api: "gitlab-duo-api" as Api,
    stream: streamGitLabDuo,
    streamSimple: streamGitLabDuo,
  });

  const model = buildModel(cfg);
  const context: Context = {
    messages: [
      {
        role: "user",
        content: "Say hello in exactly 3 words.",
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
    Stream.fromAsyncIterable(stream, (error) => new TestError({ message: String(error) })),
    (event) => Effect.sync(() => printEvent(event as ProviderEvent)),
  );
});

void runtime.runPromise(runTest).catch((error: unknown) => {
  Effect.runSync(Console.error(error instanceof TestError ? error.message : String(error)));
});
