import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import ai from "@msa/ai";
import openai from "@msa/ai/providers/openai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import { Console, Effect } from "effect";

import node from "../../src/env/node.ts";
import toolsModule from "../../src/tools/index.ts";
import support from "../support.ts";
import openJsonExampleStorage from "./json-storage.ts";

const { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } = ai;
const { openaiProvider } = openai;

const { Harness, createRegistry, watchEvents } = harnessModule;
const { defineExtension, section } = durable;
const { createBashTool, createReadTool } = toolsModule;
const { NodeExecutionEnv } = node;

const { BACKGROUND_CONTEXT, awaited, environmentVariable } = support;

const context = BACKGROUND_CONTEXT;
const args = process.argv.slice(2);
const mode = args.includes("--ops") ? "ops" : "events";
const storageIndex = args.indexOf("--storage");
const storageKind = storageIndex < 0 ? "sqlite" : args[storageIndex + 1];
const prompt =
  args.find(
    (arg, index) => !arg.startsWith("--") && (storageIndex < 0 || index !== storageIndex + 1),
  ) ?? "What is in this directory?";

const mainStep1 = Effect.gen(function* () {
  const { storage, location } = yield* openJsonExampleStorage(storageKind);
  const print = (value: unknown): void => void process.stdout.write(`${JSON.stringify(value)}\n`);

  const models = createModels();
  let model = { modelId: "gpt-6-sol", provider: "openai" };
  if (environmentVariable("OPENAI_API_KEY", true) === undefined) {
    const faux = fauxProvider({ tokensPerSecond: 200 });
    models.setProvider(faux.provider);
    model = { modelId: "faux-1", provider: "faux" };
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
      sections: [section("preamble", () => "You are a concise coding assistant.", { tag: false })],
      tools: [createReadTool(), createBashTool()],
    }),
  );
  const env = new NodeExecutionEnv({ cwd: process.cwd() });
  const harness = yield* awaited(
    Harness.open(storage, { env: () => env, models, registry }, context),
  );
  const root = yield* awaited(harness.root(context, { agent: { model } }));
  return { harness, location, print, root };
});

const main = Effect.gen(function* () {
  const { location, print, harness, root } = yield* mainStep1;
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

  const submission = yield* awaited(root.submit({ content: prompt, type: "input" }, context));
  yield* awaited(submission.wait(context));
  yield* awaited(harness.waitForIdle(context));
  yield* Effect.sleep(1);
  yield* awaited(stop());
  yield* awaited(harness.close(context));
  if (location !== undefined) yield* Console.error(`${storageKind} storage: ${location}`);
});

NodeRuntime.runMain(main);
