import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import harnessModule from "../../src/harness/index.ts";
import durable from "../../src/index.ts";
import memory from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;
const { defineEntry } = durable;

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;

const main = Effect.gen(function* () {
  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      { models: createModels(), registry: createRegistry() },
      context,
    ),
  );
  const root = yield* awaited(harness.root(context));
  yield* awaited(root.configure({ thinkingLevel: "high" }, context));

  const Message = defineEntry<{ from: string }>("message");
  const hello = yield* awaited(
    root.commit(
      (tx) =>
        tx.appendEntry(Message, root.id, {
          data: { from: "example" },
          model: [{ content: "hello", role: "user", timestamp: 1 }],
        }),
      context,
    ),
  );
  yield* Console.log("typed entry:", Message.is(hello), hello.data.from);

  const helper = yield* awaited(
    harness.createConversation(
      { agent: { thinkingLevel: "minimal" }, ownership: { kind: "ownerless" } },
      context,
    ),
  );
  const retry = yield* awaited(root.fork(hello.id, { ownership: { kind: "ownerless" } }, context));
  yield* Console.log("helper thinking:", (yield* awaited(helper.agent(context))).thinkingLevel);
  yield* Console.log("fork thinking:", (yield* awaited(retry.agent(context))).thinkingLevel);
  yield* Console.log(
    "lookup:",
    (yield* awaited(harness.conversation(retry.id, context)))?.id === retry.id,
  );

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
