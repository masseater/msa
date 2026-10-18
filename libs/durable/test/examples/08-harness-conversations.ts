import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { createRegistry, Harness } from "../../src/harness/index.ts";
import { defineEntry } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

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
          model: [{ role: "user", content: "hello", timestamp: 1 }],
        }),
      context,
    ),
  );
  yield* Console.log("typed entry:", Message.is(hello), hello.data.from);

  const helper = yield* awaited(
    harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { thinkingLevel: "minimal" } },
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
