import { readFile, rm } from "node:fs/promises";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { createRegistry, Harness } from "../../src/harness/index.ts";
import { defineDoc } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { CodingTools } from "../../src/tools/index.ts";
import { awaited } from "../effect-support.ts";
import { joinPath, makeTempDir } from "../platform-support.ts";

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

const main = Effect.gen(function* () {
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
  yield* Console.log(
    "alice's sandbox:",
    yield* awaited(readFile(joinPath(alice.path, "note.txt"), "utf8")),
  );
  yield* Console.log(
    "bob's sandbox:",
    yield* awaited(readFile(joinPath(bob.path, "note.txt"), "utf8")),
  );

  yield* awaited(harness.close(context));
  yield* awaited(rm(alice.path, { recursive: true, force: true }));
  yield* awaited(rm(bob.path, { recursive: true, force: true }));
});

NodeRuntime.runMain(main);
