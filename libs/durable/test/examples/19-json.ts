// JSON mode: stream one prompt's run as JSON lines, like `msa --mode json`. Two modes:
//   --events (default): the experimental agent events of watchEvents(), starting with a `snapshot` event.
//   --ops: the raw ConversationView frames, starting with the view itself; each later line holds one commit's ops.
// --storage sqlite (default) | jsonl | memory: sqlite writes a temporary database file, jsonl a temporary directory;
// neither is deleted, and the path is printed to stderr at the end.
// Uses OpenAI when OPENAI_API_KEY is set, and a scripted faux model otherwise.
// Run from libs/durable:
//   node --conditions=source --experimental-strip-types test/examples/19-json.ts --events "What is in this directory?"

import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai/providers/faux";
import { openaiProvider } from "@msa/ai/providers/openai";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import {
  createRegistry,
  defineExtension,
  Harness,
  MemoryStorage,
  type Storage,
  section,
  watchEvents,
} from "../../src/index.ts";
import { openNodeJsonlStorage } from "../../src/storage/jsonl/node.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import { createBashTool, createReadTool } from "../../src/tools/index.ts";
import { makeTempDir, tempPath } from "../temp-support.ts";

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
if (storageKind === "sqlite") {
  location = tempPath(`msa-durable-json-${Date.now()}.sqlite`);
  storage = await openNodeSqliteStorage(location);
} else if (storageKind === "jsonl") {
  location = await makeTempDir("msa-durable-json-");
  storage = await openNodeJsonlStorage(location, context);
} else if (storageKind === "memory") {
  storage = new MemoryStorage();
} else {
  throw new Error(`Unknown --storage ${storageKind}; use sqlite, jsonl, or memory`);
}
const print = (value: unknown): void => void process.stdout.write(`${JSON.stringify(value)}\n`);

const models = createModels();
let model = { provider: "openai", modelId: "gpt-6-sol" };
if (process.env["OPENAI_API_KEY"] === undefined) {
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
const harness = await Harness.open(storage, { models, registry, env: () => env }, context);
const root = await harness.root(context, { agent: { model } });

// Attach before submitting, so the stream covers the whole run.
let stop: () => Promise<unknown>;
if (mode === "events") {
  const stream = await watchEvents(harness, root.id, context);
  print(stream.snapshot);
  stream.start((events) => {
    for (const event of events) print(event);

    return Promise.resolve();
  });
  stop = () => stream.stop();
} else {
  const watch = await root.watch(context);
  print({ view: watch.value });
  watch.start((_value, ops) => Promise.resolve(print({ ops })));
  stop = () => watch.stop();
}

const submission = await root.submit({ type: "input", content: prompt }, context);
await submission.wait(context);
await harness.waitForIdle(context);
// Let the last batch reach the listener before stopping.
await new Promise((resolve) => {
  setTimeout(resolve, 0);
});
await stop();
await harness.close(context);
if (location !== undefined) console.error(`${storageKind} storage: ${location}`);
