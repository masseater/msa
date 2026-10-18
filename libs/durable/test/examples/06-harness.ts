import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Type } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { createRegistry, Harness } from "../../src/harness/index.ts";
import { AgentDoc, defineDoc, defineExtension, defineTool } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

const context = BACKGROUND_CONTEXT;

const read = defineTool({
  name: "read",
  description: "Read a file",
  parameters: Type.Object({ path: Type.String() }),
  execute: (args) =>
    Promise.resolve({ output: [{ type: "text", text: `contents of ${args.path}` }] }),
});
const Files = defineExtension({ name: "files", tools: [read] });
const registry = createRegistry();
registry.install(Files);

const main = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { models: createModels(), registry }, context),
  );

  const Notes = defineDoc<{ text: string }>({
    kind: "example.notes",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ text: "" }),
  });

  const root = yield* awaited(
    harness.root(context, {
      agent: { thinkingLevel: "low" },
      init: (tx, rootId) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes, rootId))).text = "root notes";
          }),
        ),
    }),
  );
  yield* Console.log("root:", root.id, yield* awaited(harness.snapshot(Notes, root.id, context)));
  yield* Console.log("stored agent:", yield* awaited(harness.snapshot(AgentDoc, root.id, context)));
  const agent = yield* awaited(root.agent(context));
  yield* Console.log(
    "resolved:",
    agent.thinkingLevel,
    agent.extensions.map((extension) => extension.name),
    agent.tools.map((tool) => tool.name),
  );

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
