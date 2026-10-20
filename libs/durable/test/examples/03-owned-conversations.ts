import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import durable from "../../src/index.ts";
import type durableTypes from "../../src/index.types.ts";
import sessionModule from "../../src/session/index.ts";
import memory from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { createSession } = sessionModule;
const { MemoryStorage } = memory;
const { defineDoc, defineTask } = durable;

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;
const session = createSession(new MemoryStorage());

const Supervisor = defineTask<null, { phase: "ready" }, null>({
  abort: () => Promise.resolve(),
  initial: () => ({ phase: "ready" }),
  name: "example.supervisor",
  phases: { ready: () => Promise.resolve() },
  version: 1,
});

const AgentRegistry = defineDoc<{
  agents: Record<string, { conversationId: durableTypes.ConversationId; requestId: string }>;
}>({
  fork: "initial",
  history: "latest",
  initial: () => ({ agents: {} }),
  kind: "example.agent-registry",
  scope: "conversation",
  version: 1,
});

const main = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const mainInner = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );

  const setup = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const supervisorId = yield* awaited(
              tx.createTask(Supervisor, null, {
                background: true,
                conversationId: mainInner.id,
                ownership: { kind: "conversation" },
              }),
            );

            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: supervisorId } }),
            );

            (yield* awaited(tx.doc(AgentRegistry, mainInner.id))).agents["researcher"] = {
              conversationId: child.id,
              requestId: `researcher:first-message:${supervisorId}`,
            };
            return { child, supervisorId };
          }),
        ),
      context,
    ),
  );

  yield* Console.log("supervisor task:", setup.supervisorId);
  yield* Console.log("child conversation:", setup.child);
  yield* Console.log(
    "registry:",
    yield* awaited(session.snapshot(AgentRegistry, mainInner.id, context)),
  );

  yield* awaited(session.close(context));
});

NodeRuntime.runMain(main);
