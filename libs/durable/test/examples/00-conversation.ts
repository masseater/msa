import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { createSession } from "../../src/session/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

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
