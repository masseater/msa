import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import memory from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import node from "../../src/env/node.ts";
import toolsModule from "../../src/tools/index.ts";
import support from "../support.ts";

const { defineDoc } = durable;
const { Harness, createRegistry } = harnessModule;
const { CodingTools } = toolsModule;
const { MemoryStorage } = memory;
const { NodeExecutionEnv } = node;

const { awaited, joinPath, makeTempDir, readText, removeDir } = support;

const context = BACKGROUND_CONTEXT;

const Sandbox = defineDoc<{ path?: string }>({
  fork: "initial",
  history: "latest",
  initial: () => ({}),
  kind: "app.sandbox",
  scope: "conversation",
  version: 1,
});

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
const note = (text: string) =>
  fauxAssistantMessage(fauxToolCall("write", { content: text, path: "note.txt" }), {
    stopReason: "toolUse",
  });
faux.setResponses([
  note("from alice"),
  fauxAssistantMessage("Saved."),
  note("from bob"),
  fauxAssistantMessage("Saved."),
]);

const registry = createRegistry();
registry.install(CodingTools);

const mainStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      {
        env: ({ conversationId, read }, envContext) =>
          runPromise(
            Effect.gen(function* () {
              const sandbox = yield* awaited(read.snapshot(Sandbox, conversationId, envContext));
              return sandbox?.path === undefined
                ? undefined
                : new NodeExecutionEnv({ cwd: sandbox.path });
            }),
          ),
        models,
        registry,
      },
      context,
    ),
  );

  const model = { modelId: "faux-1", provider: "faux" };
  return { harness, model };
});

const main = Effect.gen(function* () {
  const { harness, model } = yield* mainStep1;
  const conversationFor = Effect.fn("conversationFor")(function* (user: string) {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const path = yield* makeTempDir(`msa-durable-sandbox-${user}-`);
    const conversation = yield* awaited(
      harness.createConversation(
        {
          agent: { model },
          init: (tx, id) =>
            runPromise(
              Effect.gen(function* () {
                (yield* awaited(tx.doc(Sandbox, id))).path = path;
              }),
            ),
          ownership: { kind: "ownerless" },
        },
        context,
      ),
    );
    return { conversation, path };
  });

  const alice = yield* conversationFor("alice");
  const bob = yield* conversationFor("bob");
  yield* awaited(
    (yield* awaited(
      alice.conversation.submit({ content: "Leave a note.", type: "input" }, context),
    )).wait(context),
  );
  yield* awaited(
    (yield* awaited(
      bob.conversation.submit({ content: "Leave a note.", type: "input" }, context),
    )).wait(context),
  );
  yield* Console.log("alice's sandbox:", yield* readText(joinPath(alice.path, "note.txt")));
  yield* Console.log("bob's sandbox:", yield* readText(joinPath(bob.path, "note.txt")));

  yield* awaited(harness.close(context));
  yield* removeDir(alice.path);
  yield* removeDir(bob.path);
});

NodeRuntime.runMain(main);
