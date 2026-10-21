import type durableTypes from "@msa/durable/index.types";
import sessionModule from "@msa/durable/session";
import { Effect } from "effect";

import node from "../src/storage/sqlite/node.ts";
import type harnessStructuredRecoveryCasesTypes from "./harness-structured-recovery-cases.types.ts";
import harnessStructuredSupport from "./harness-structured-support.ts";
import support from "./support.ts";

const { createSession } = sessionModule;
const { openNodeSqliteStorage } = node;

const { Node, OWN_CONVERSATION, spawn } = harnessStructuredSupport;
const { awaited, context } = support;

const seedStep1 = Effect.fn("seedStep1")(function* (path: string, children: readonly string[]) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const session = createSession(yield* awaited(openNodeSqliteStorage(path)));
  const seeded = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const root = yield* awaited(
              tx.createConversation({ ownership: { kind: "ownerless" } }),
            );
            const parent = yield* awaited(
              tx.createTask(
                Node,
                { name: "parent" },
                { ...OWN_CONVERSATION, conversationId: root.id },
              ),
            );
            const ids: durableTypes.TaskId[] = [];
            for (const name of children) ids.push(yield* awaited(spawn(tx, parent, name)));
            return { children: ids, parent };
          }),
        ),
      context,
    ),
  );
  return { runPromise, seeded, session };
});

const seed = Effect.fn("seed")(function* (
  path: string,
  children: readonly string[],
  edit: (
    set: (id: durableTypes.TaskId, patch: object) => Promise<void>,
    seeded: harnessStructuredRecoveryCasesTypes.Seeded,
  ) => Promise<void>,
) {
  const { runPromise, session, seeded } = yield* seedStep1(path, children);
  yield* awaited(
    edit(
      (id, patch) =>
        runPromise(
          Effect.gen(function* () {
            const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              session.commit(
                (tx) =>
                  runNested(
                    Effect.gen(function* () {
                      const record = (yield* awaited(tx.task(id)))!;
                      (tx as unknown as { setTask(value: unknown): void }).setTask({
                        ...record,
                        ...patch,
                      });
                    }),
                  ),
                context,
              ),
            );
          }),
        ),
      seeded,
    ),
  );
  yield* awaited(session.close(context));
  return seeded;
});

const COMPLETED = { outcome: { result: "done", status: "completed" }, status: "terminal" };

const harnessStructuredRecoveryCases = {
  COMPLETED,
  seed,
};

export default harnessStructuredRecoveryCases;
