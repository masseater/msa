import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Type } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai/providers/faux";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import harnessModule from "../../src/harness/index.ts";
import durable from "../../src/index.ts";
import memory from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { defineDoc, defineExtension, defineTool, section } = durable;
const { Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;

const Todos = defineDoc<{ items: string[] }>({
  fork: "asOf",
  history: "rewindable",
  initial: () => ({ items: [] }),
  kind: "example.todos",
  scope: "conversation",
  version: 1,
});

const Todo = defineExtension({
  name: "todo",
  sections: [
    section("todos", (input, renderContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const todos = yield* awaited(
            input.read.snapshot(Todos, input.conversationId, renderContext),
          );
          return todos === undefined || todos.items.length === 0
            ? undefined
            : todos.items.join("\n");
        }),
      ),
    ),
  ],
  tools: [
    defineTool({
      description: "Add an item to your todo list",
      execute: (args, api, callContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              api.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      (yield* awaited(tx.doc(Todos, api.conversationId))).items.push(args.item);
                    }),
                  ),
                callContext,
              ),
            );
            return { output: [{ text: `added ${args.item}`, type: "text" }] };
          }),
        ),
      name: "todo",
      parameters: Type.Object({ item: Type.String() }),
    }),
  ],
});

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Todo);

const main = Effect.gen(function* () {
  const harness = yield* awaited(Harness.open(new MemoryStorage(), { models, registry }, context));
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("todo", { item: "fix the build" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Noted."),
    fauxAssistantMessage("Working on it."),
  ]);
  yield* awaited(
    (yield* awaited(
      root.submit({ content: "Remember to fix the build.", type: "input" }, context),
    )).wait(context),
  );
  yield* Console.log("todos:", yield* awaited(harness.snapshot(Todos, root.id, context)));

  yield* awaited(
    (yield* awaited(root.submit({ content: "What is next?", type: "input" }, context))).wait(
      context,
    ),
  );
  const { messages } = yield* awaited(root.context(context));
  yield* Console.log(
    "system messages:",
    messages.flatMap((message) =>
      message.role === "system"
        ? [
            {
              sections: message.sections,
              toolsAdded: message.toolsAdded?.map((tool) => tool.name),
            },
          ]
        : [],
    ),
  );

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
