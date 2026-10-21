import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import sessionModule from "../../src/session/index.ts";
import memory from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { createSession } = sessionModule;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;

const session = createSession(new MemoryStorage());

const context = BACKGROUND_CONTEXT;

const main = Effect.gen(function* () {
  const standalone = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );
  yield* Console.log("standalone conversation:", standalone);

  yield* awaited(session.close(context));
});

NodeRuntime.runMain(main);
