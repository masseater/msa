import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Type } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { createRegistry, Harness } from "../../src/harness/index.ts";
import { defineDoc, defineExtension, defineTool, section } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

const context = BACKGROUND_CONTEXT;

const Todos = defineDoc<{ items: string[] }>({
  kind: "example.todos",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ items: [] }),
});

const Todo = defineExtension({
  name: "todo",
  tools: [
    defineTool({
      name: "todo",
      description: "Add an item to your todo list",
      parameters: Type.Object({ item: Type.String() }),
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
            return { output: [{ type: "text", text: `added ${args.item}` }] };
          }),
        ),
    }),
  ],
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
      agent: { model: { provider: "faux", modelId: "faux-1" } },
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
      root.submit({ type: "input", content: "Remember to fix the build." }, context),
    )).wait(context),
  );
  yield* Console.log("todos:", yield* awaited(harness.snapshot(Todos, root.id, context)));

  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "What is next?" }, context))).wait(
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
