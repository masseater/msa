import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { defineDoc } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { CodingTools } from "../../src/tools/index.ts";
import { awaited, joinPath, makeTempDir, readText, removeDir } from "../support.ts";

const context = BACKGROUND_CONTEXT;

const Sandbox = defineDoc<{ path?: string }>({
  kind: "app.sandbox",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({}),
});

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
const note = (text: string) =>
  fauxAssistantMessage(fauxToolCall("write", { path: "note.txt", content: text }), {
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
        models,
        registry,
        env: ({ conversationId, read }, envContext) =>
          runPromise(
            Effect.gen(function* () {
              const sandbox = yield* awaited(read.snapshot(Sandbox, conversationId, envContext));
              return sandbox?.path === undefined
                ? undefined
                : new NodeExecutionEnv({ cwd: sandbox.path });
            }),
          ),
      },
      context,
    ),
  );

  const model = { provider: "faux", modelId: "faux-1" };
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
          ownership: { kind: "ownerless" },
          agent: { model },
          init: (tx, id) =>
            runPromise(
              Effect.gen(function* () {
                (yield* awaited(tx.doc(Sandbox, id))).path = path;
              }),
            ),
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
      alice.conversation.submit({ type: "input", content: "Leave a note." }, context),
    )).wait(context),
  );
  yield* awaited(
    (yield* awaited(
      bob.conversation.submit({ type: "input", content: "Leave a note." }, context),
    )).wait(context),
  );
  yield* Console.log("alice's sandbox:", yield* readText(joinPath(alice.path, "note.txt")));
  yield* Console.log("bob's sandbox:", yield* readText(joinPath(bob.path, "note.txt")));

  yield* awaited(harness.close(context));
  yield* removeDir(alice.path);
  yield* removeDir(bob.path);
});

NodeRuntime.runMain(main);
