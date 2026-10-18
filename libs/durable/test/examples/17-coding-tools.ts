import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  type ToolResultMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import { AssistantEntry, defineExtension, hook, ToolResultEntry } from "@msa/durable";
import { createRegistry, Harness, ToolTask } from "@msa/durable/harness";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { openNodeJsonlStorage } from "../../src/storage/jsonl/node.ts";
import { type BashToolInput, CodingTools } from "../../src/tools/index.ts";
import {
  readTempFile,
  writeTempFile,
  makeTempDir,
  awaited,
  toJsonText,
  BACKGROUND_CONTEXT,
  currentTimeMillis,
} from "../support.ts";

const context = BACKGROUND_CONTEXT;

const main = Effect.gen(function* () {
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-example-");
  yield* writeTempFile(directory, "notes.txt", "hello world\n");

  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const toolCall = (name: string, args: Parameters<typeof fauxToolCall>[1], id: string) =>
    fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
  faux.setResponses([
    toolCall("read", { path: "notes.txt" }, "r"),
    toolCall("edit", { path: "notes.txt", edits: [{ oldText: "world", newText: "durable" }] }, "e"),
    toolCall("bash", { command: "cat notes.txt" }, "b"),
    toolCall("bash", { command: "cat /tmp/1gb.txt" }, "c"),
    fauxAssistantMessage([fauxText("The file now greets durable.")]),
  ]);

  const isBigCat = (call: { name: string; arguments: unknown }) =>
    call.name === "bash" && (call.arguments as BashToolInput).command.includes("1gb.txt");
  let start = 0;
  const Timing = defineExtension({
    name: "timing",
    hooks: [
      hook(ToolTask, {
        beforeTool: (call) => {
          if (isBigCat(call)) start = currentTimeMillis();
          return undefined;
        },
        afterTool: (call) => {
          if (isBigCat(call))
            runSync(Console.log(`cat /tmp/1gb.txt took ${currentTimeMillis() - start} ms`));
          return undefined;
        },
      }),
    ],
  });
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(Timing);

  const storage = yield* awaited(openNodeJsonlStorage(directory, context));
  const harness = yield* awaited(
    Harness.open(
      storage,
      {
        models,
        registry,
        env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? process.cwd() }),
      },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" }, cwd: directory },
    }),
  );

  const settled = yield* awaited(
    (yield* awaited(
      root.submit({ type: "input", content: "Greet durable instead." }, context),
    )).wait(context),
  );
  yield* Console.log("status:", settled.status);
  const transcript = yield* awaited(root.entries({}, 20, undefined, context));
  for (const entry of [...transcript.items].reverse()) {
    if (!ToolResultEntry.is(entry)) {
      yield* Console.log(entry.kind);
      continue;
    }
    const result = entry.model![0] as ToolResultMessage;
    const text = result.content.map((item) => (item.type === "text" ? item.text : "")).join("");
    yield* Console.log(
      `${entry.kind} ${result.toolName}:`,
      yield* toJsonText(text.length > 200 ? `${text.slice(0, 200)}…` : text),
    );
  }
  if (settled.status === "done" && settled.type === "input") {
    const answer = yield* awaited(
      root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context),
    );
    const message = answer?.model?.[0];
    yield* Console.log("answer:", message?.role === "assistant" ? message.content : message);
  }
  yield* Console.log("file:", yield* toJsonText(yield* readTempFile(directory, "notes.txt")));
  yield* awaited(harness.close(context));
  yield* Console.log("storage:", directory);
});

NodeRuntime.runMain(main);
