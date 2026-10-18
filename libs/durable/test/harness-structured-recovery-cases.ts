import { type TaskId } from "@msa/durable";
import { createSession } from "@msa/durable/session";
import { Effect } from "effect";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { Node, OWN_CONVERSATION, spawn } from "./harness-structured-support.ts";
import { awaited, context } from "./support.ts";

export type Seeded = { parent: TaskId; children: TaskId[] };

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
            const ids: TaskId[] = [];
            for (const name of children) ids.push(yield* awaited(spawn(tx, parent, name)));
            return { parent, children: ids };
          }),
        ),
      context,
    ),
  );
  return { runPromise, session, seeded };
});

export const seed = Effect.fn("seed")(function* (
  path: string,
  children: readonly string[],
  edit: (set: (id: TaskId, patch: object) => Promise<void>, seeded: Seeded) => Promise<void>,
) {
  const { runPromise, session, seeded } = yield* seedStep1(path, children);
  yield* awaited(
    edit(
      (id, patch) =>
        runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              session.commit(
                (tx) =>
                  runPromise(
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

export const COMPLETED = { status: "terminal", outcome: { status: "completed", result: "done" } };
