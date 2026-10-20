import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";
import sessionTablesSupport from "./session-tables-support.ts";

const { awaited } = effectSupport;

const { context, createConversation, openTestSession } = sessionSupport;

const { WorkTask } = sessionTablesSupport;

const createsConversationExplicitlyStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const created = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const supervisorId = yield* awaited(
              tx.createTask(
                WorkTask,
                { path: "background" },
                {
                  background: true,
                  conversationId: parentId,
                  ownership: { kind: "conversation" },
                },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: supervisorId },
              }),
            );
            return { child, supervisorId };
          }),
        ),
      context,
    ),
  );

  expect(created.child.owner).toEqual({
    conversationId: parentId,
    taskId: created.supervisorId,
  });
  expect(yield* awaited(storage.conversation(created.child.id, context))).toEqual(created.child);
  return { created, parentId, runPromise, session, storage };
});

const createsConversationExplicitly = Effect.gen(function* () {
  const { runPromise, session, storage, parentId, created } =
    yield* createsConversationExplicitlyStep1;
  yield* awaited(
    expect(
      session.commitWith(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              const supervisor = (yield* awaited(tx.task(created.supervisorId)))!;
              tx.setTask({ ...supervisor, conversationId: created.child.id });
            }),
          ),
        context,
      ),
    ).rejects.toThrow(`Task ${created.supervisorId} cannot change conversations`),
  );
  expect((yield* awaited(storage.task(created.supervisorId, context)))?.conversationId).toBe(
    parentId,
  );
});

describe("Session transaction tables", () => {
  it("creates a conversation with an explicitly staged task owner", () =>
    Effect.runPromise(createsConversationExplicitly));
});
