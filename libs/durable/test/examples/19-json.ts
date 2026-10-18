import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai/providers/faux";
import { openaiProvider } from "@msa/ai/providers/openai";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { currentTimeMillis } from "../../src/clock.ts";
import { environmentVariable } from "../../src/env/node-process.ts";
import { NodeExecutionEnv } from "../../src/env/node.ts";
import { createRegistry, Harness, watchEvents } from "../../src/harness/index.ts";
import { defineExtension, type Storage, section } from "../../src/index.ts";
import { openNodeJsonlStorage } from "../../src/storage/jsonl/node.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import { createBashTool, createReadTool } from "../../src/tools/index.ts";
import { awaited } from "../effect-support.ts";
import { makeTempDir, tempPath } from "../platform-support.ts";

const context = BACKGROUND_CONTEXT;
const args = process.argv.slice(2);
const mode = args.includes("--ops") ? "ops" : "events";
const storageIndex = args.indexOf("--storage");
const storageKind = storageIndex < 0 ? "sqlite" : args[storageIndex + 1];
const prompt =
  args.find(
    (arg, index) => !arg.startsWith("--") && (storageIndex < 0 || index !== storageIndex + 1),
  ) ?? "What is in this directory?";

let storage: Storage;
let location: string | undefined;

const main = Effect.gen(function* () {
  if (storageKind === "sqlite") {
    location = tempPath(`msa-durable-json-${currentTimeMillis()}.sqlite`);
    storage = yield* awaited(openNodeSqliteStorage(location));
  } else if (storageKind === "jsonl") {
    location = yield* makeTempDir("msa-durable-json-");
    storage = yield* awaited(openNodeJsonlStorage(location, context));
  } else if (storageKind === "memory") {
    storage = new MemoryStorage();
  } else {
    throw new Error(`Unknown --storage ${storageKind}; use sqlite, jsonl, or memory`);
  }
  const print = (value: unknown): void => void process.stdout.write(`${JSON.stringify(value)}\n`);

  const models = createModels();
  let model = { provider: "openai", modelId: "gpt-6-sol" };
  if (environmentVariable("OPENAI_API_KEY", true) === undefined) {
    const faux = fauxProvider({ tokensPerSecond: 200 });
    models.setProvider(faux.provider);
    model = { provider: "faux", modelId: "faux-1" };
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: "ls" }, { id: "call-1" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([
        fauxText("This directory holds the durable package sources, tests, and docs."),
      ]),
    ]);
  } else {
    models.setProvider(openaiProvider());
  }

  const registry = createRegistry();
  registry.install(
    defineExtension({
      name: "coding",
      tools: [createReadTool(), createBashTool()],
      sections: [section("preamble", () => "You are a concise coding assistant.", { tag: false })],
    }),
  );
  const env = new NodeExecutionEnv({ cwd: process.cwd() });
  const harness = yield* awaited(
    Harness.open(storage, { models, registry, env: () => env }, context),
  );
  const root = yield* awaited(harness.root(context, { agent: { model } }));

  let stop: () => Promise<unknown>;
  if (mode === "events") {
    const stream = yield* awaited(watchEvents(harness, root.id, context));
    print(stream.snapshot);
    stream.start((events) => {
      for (const event of events) print(event);

      return Promise.resolve();
    });
    stop = () => stream.stop();
  } else {
    const watch = yield* awaited(root.watch(context));
    print({ view: watch.value });
    watch.start((_value, ops) => Promise.resolve(print({ ops })));
    stop = () => watch.stop();
  }

  const submission = yield* awaited(root.submit({ type: "input", content: prompt }, context));
  yield* awaited(submission.wait(context));
  yield* awaited(harness.waitForIdle(context));
  yield* Effect.sleep(1);
  yield* awaited(stop());
  yield* awaited(harness.close(context));
  if (location !== undefined) yield* Console.error(`${storageKind} storage: ${location}`);
});

NodeRuntime.runMain(main);
