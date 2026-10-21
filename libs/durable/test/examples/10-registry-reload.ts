import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import ai from "@msa/ai";
import modelsModule from "@msa/ai/models";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import harnessModule from "../../src/harness/index.ts";
import durable from "../../src/index.ts";
import memory from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { Type } = ai;
const { createModels } = modelsModule;

const { BACKGROUND_CONTEXT } = contextModule;

const { defineExtension, defineTool, wrapTool } = durable;
const { Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;

function exampleTool(name: string, description: string) {
  return defineTool({
    description,
    execute: (args) =>
      Promise.resolve({ output: [{ text: `${name} ${args.path}`, type: "text" }] }),
    name,
    parameters: Type.Object({ path: Type.String() }),
  });
}

const read = exampleTool("read", "Read a file");
const registry = createRegistry();
registry.install(
  defineExtension({ name: "files", tools: [read, exampleTool("grep", "Search files")] }),
);

const main = Effect.gen(function* () {
  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { models: createModels(), registry }, context),
  );
  const root = yield* awaited(harness.root(context));
  const tools = Effect.fn("tools")(function* () {
    return (yield* awaited(root.agent(context))).tools.map(
      (tool) => `${tool.name}: ${tool.description}`,
    );
  });

  registry.install(
    defineExtension({
      name: "files",
      tools: [read, exampleTool("grep", "Search files, faster")],
    }),
  );
  yield* Console.log("after reload:", yield* tools());

  const Audit = defineExtension({
    name: "audit",
    wraps: [wrapTool(read, (tool) => ({ ...tool, description: `${tool.description} (audited)` }))],
  });
  registry.install(Audit);
  yield* Console.log("with audit:", yield* tools());

  registry.uninstall(Audit);
  yield* Console.log("after uninstall:", yield* tools());

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
