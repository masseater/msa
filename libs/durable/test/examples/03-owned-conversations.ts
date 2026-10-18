import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { type ConversationId, defineDoc, defineTask } from "../../src/index.ts";
import { createSession } from "../../src/session/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

const context = BACKGROUND_CONTEXT;
const session = createSession(new MemoryStorage());

const Supervisor = defineTask<null, { phase: "ready" }, null>({
  name: "example.supervisor",
  version: 1,
  initial: () => ({ phase: "ready" }),
  phases: { ready: () => Promise.resolve() },
  abort: () => Promise.resolve(),
});

const AgentRegistry = defineDoc<{
  agents: Record<string, { conversationId: ConversationId; requestId: string }>;
}>({
  kind: "example.agent-registry",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ agents: {} }),
});

const main = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const main = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );

  const setup = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const supervisorId = yield* awaited(
              tx.createTask(Supervisor, null, {
                ownership: { kind: "conversation" },
                conversationId: main.id,
                background: true,
              }),
            );

            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: supervisorId } }),
            );

            (yield* awaited(tx.doc(AgentRegistry, main.id))).agents["researcher"] = {
              conversationId: child.id,
              requestId: `researcher:first-message:${supervisorId}`,
            };
            return { supervisorId, child };
          }),
        ),
      context,
    ),
  );

  yield* Console.log("supervisor task:", setup.supervisorId);
  yield* Console.log("child conversation:", setup.child);
  yield* Console.log(
    "registry:",
    yield* awaited(session.snapshot(AgentRegistry, main.id, context)),
  );

  yield* awaited(session.close(context));
});

NodeRuntime.runMain(main);
