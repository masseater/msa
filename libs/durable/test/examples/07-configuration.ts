import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import ai from "@msa/ai";
import modelsModule from "@msa/ai/models";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import harnessModule from "../../src/harness/index.ts";
import durable from "../../src/index.ts";
import type durableTypes from "../../src/index.types.ts";
import memory from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { Type } = ai;
const { createModels } = modelsModule;

const { BACKGROUND_CONTEXT } = contextModule;

const { AgentDoc, defineExtension, defineTool, section } = durable;
const { Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;

type AppTool = durableTypes.ToolRegistration & { readonly snippet?: string };

function exampleTool(name: string, description: string): AppTool {
  const tool = defineTool({
    description,
    execute: (args) =>
      Promise.resolve({ output: [{ text: `${name} ${args.path}`, type: "text" }] }),
    name,
    parameters: Type.Object({ path: Type.String() }),
  });
  return { ...tool, snippet: `Use ${name} for files.` };
}

const read = exampleTool("read", "Read a file");
const write = exampleTool("write", "Write a file");
const grep = exampleTool("grep", "Search files");
const Files = defineExtension<AppTool>({ name: "files", tools: [read, write] });
const Search = defineExtension<AppTool>({ name: "search", tools: [grep] });
const Snippets = defineExtension<AppTool>({
  name: "snippets",
  sections: [
    section("tool_snippets", (input) => input.agent.tools.map((tool) => tool.snippet).join("\n")),
  ],
});

const registry = createRegistry<AppTool>();
registry.install(Files);
registry.install(Search);
registry.install(Snippets);

let timeoutMs = 60_000;
const settings: durableTypes.HarnessSettings = {
  retry: { maxRetries: 5 },
  get stream() {
    return { timeoutMs };
  },
  toolExecution: "sequential",
};

const main = Effect.gen(function* () {
  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { models: createModels(), registry, settings }, context),
  );
  const root = yield* awaited(harness.root(context));

  const tools = Effect.fn("tools")(function* () {
    return (yield* awaited(root.agent(context))).tools.map((tool) => tool.name);
  });
  yield* Console.log("default tools:", yield* tools());

  yield* awaited(
    root.configure(
      {
        model: { modelId: "claude-sonnet-4-5", provider: "anthropic-api" },
        thinkingLevel: "high",
        tools: [write, read],
      },
      context,
    ),
  );
  yield* Console.log("stored:", yield* awaited(harness.snapshot(AgentDoc, root.id, context)));
  const agent = yield* awaited(root.agent(context));
  yield* Console.log(
    "model:",
    agent.model,
    "thinking:",
    agent.thinkingLevel,
    "tools:",
    yield* tools(),
  );

  yield* awaited(root.configure({ extensions: { remove: [Search] }, tools: null }, context));
  yield* Console.log("without search:", yield* tools());

  yield* awaited(root.configure({ extensions: [Files, Search] }, context));
  registry.uninstall(Files);
  yield* Console.log("files uninstalled:", yield* tools());
  registry.install(Files);
  yield* Console.log("files reinstalled:", yield* tools());

  timeoutMs = 120_000;

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
