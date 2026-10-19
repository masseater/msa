import { type ConversationId, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import { awaited } from "./effect-support.ts";
import { context, createConversation, openTestSession } from "./session-support.ts";
import { WorkTask, createTask, terminal } from "./session-tables-support.ts";

const expectMissingOwnerRejected = Effect.fn("expectMissingOwnerRejected")(function* (
  session: ReturnType<typeof openTestSession>["session"],
) {
  const missingTaskId = idFromNumber<TaskId>(999);
  yield* awaited(
    expect(
      session.commit(
        (tx) => tx.createConversation({ ownership: { kind: "task", taskId: missingTaskId } }),
        context,
      ),
    ).rejects.toThrow("Conversation owner task 999 does not exist"),
  );
});

const expectAbortMarkedOwnerRejected = Effect.fn("expectAbortMarkedOwnerRejected")(function* (
  session: ReturnType<typeof openTestSession>["session"],
  storage: ReturnType<typeof openTestSession>["storage"],
  parentId: ConversationId,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let rejectedChildId: ConversationId | undefined;
  yield* awaited(
    expect(
      session.commitWith(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              const supervisorId = yield* awaited(
                tx.createTask(
                  WorkTask,
                  { path: "aborting" },
                  { ownership: { kind: "conversation" }, conversationId: parentId },
                ),
              );
              rejectedChildId = (yield* awaited(
                tx.createConversation({ ownership: { kind: "task", taskId: supervisorId } }),
              )).id;
              tx.setTask({
                id: supervisorId,
                conversationId: parentId,
                kind: WorkTask.definition.name,
                version: WorkTask.definition.version,
                input: { path: "aborting" },
                background: false,
                abortRequested: true,
                state: { status: "pending", checkpoint: { phase: "start" } },
              });
            }),
          ),
        context,
      ),
    ).rejects.toThrow("is abort-marked"),
  );
  expect(rejectedChildId).toBeDefined();
  if (rejectedChildId === undefined) throw new Error("Expected a rejected child ID");
  expect(yield* awaited(storage.conversation(rejectedChildId, context))).toBeUndefined();
});

const expectTerminalOwnerRejected = Effect.fn("expectTerminalOwnerRejected")(function* (
  session: ReturnType<typeof openTestSession>["session"],
  parentId: ConversationId,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* awaited(
    expect(
      session.commitWith(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              const supervisorId = yield* awaited(
                tx.createTask(
                  WorkTask,
                  { path: "terminal" },
                  { ownership: { kind: "conversation" }, conversationId: parentId },
                ),
              );
              yield* awaited(
                tx.createConversation({ ownership: { kind: "task", taskId: supervisorId } }),
              );
              tx.setTask({
                id: supervisorId,
                conversationId: parentId,
                kind: WorkTask.definition.name,
                version: WorkTask.definition.version,
                input: { path: "terminal" },
                background: false,
                abortRequested: false,
                state: {
                  status: "terminal",
                  outcome: { status: "completed", result: { ok: true } },
                },
              });
            }),
          ),
        context,
      ),
    ).rejects.toThrow("is terminal"),
  );
});

const expectCommittedTerminalOwnerRejected = Effect.fn("expectCommittedTerminalOwnerRejected")(
  function* (session: ReturnType<typeof openTestSession>["session"], parentId: ConversationId) {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const terminalOwnerId = yield* awaited(createTask(session, parentId));
    yield* awaited(
      session.commitWith(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              tx.setTask(terminal((yield* awaited(tx.task(terminalOwnerId)))!));
            }),
          ),
        context,
      ),
    );
    yield* awaited(
      expect(
        session.commit(
          (tx) => tx.createConversation({ ownership: { kind: "task", taskId: terminalOwnerId } }),
          context,
        ),
      ).rejects.toThrow("is terminal"),
    );
  },
);

const rejectsMissingTerminal = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  let movedStagedTaskId: TaskId<{ ok: boolean }> | undefined;
  yield* awaited(
    expect(
      session.commitWith(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              const taskId = yield* awaited(
                tx.createTask(
                  WorkTask,
                  { path: "move" },
                  { ownership: { kind: "conversation" }, conversationId: parentId },
                ),
              );
              movedStagedTaskId = taskId;
              tx.setTask({
                id: taskId,
                conversationId: idFromNumber<ConversationId>(998),
                kind: WorkTask.definition.name,
                version: WorkTask.definition.version,
                input: { path: "move" },
                background: false,
                abortRequested: false,
                state: { status: "pending", checkpoint: { phase: "start" } },
              });
            }),
          ),
        context,
      ),
    ).rejects.toThrow("cannot change conversations"),
  );
  if (movedStagedTaskId === undefined) throw new Error("Expected a staged task ID");
  expect(yield* awaited(storage.task(movedStagedTaskId, context))).toBeUndefined();
  yield* expectMissingOwnerRejected(session);
  yield* expectAbortMarkedOwnerRejected(session, storage, parentId);
  yield* expectTerminalOwnerRejected(session, parentId);
  yield* expectCommittedTerminalOwnerRejected(session, parentId);
});

describe("Session transaction tables", () => {
  it("rejects missing, terminal, and abort-marked conversation owners atomically", () =>
    Effect.runPromise(rejectsMissingTerminal));
});

const takesOwnershipTable = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const payload = { nested: { value: 1 } };
  const entry = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const created = yield* awaited(
              tx.appendEntry(conversationId, { kind: "data", data: payload }),
            );
            payload.nested.value = 2;
            return created;
          }),
        ),
      context,
    ),
  );
  expect((yield* awaited(storage.entry(entry.id, context)))!.entry.data).toEqual({
    nested: { value: 1 },
  });
  const omitted = yield* awaited(
    session.commit(
      (tx) => tx.appendEntry(conversationId, { kind: "omitted", data: undefined }),
      context,
    ),
  );
  expect(Object.hasOwn(omitted, "data")).toBe(false);
  expect(Object.hasOwn((yield* awaited(storage.entry(omitted.id, context)))!.entry, "data")).toBe(
    false,
  );

  const commits = storage.commits.length;
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          tx
            .appendEntry(conversationId, { kind: "invalid", data: Number.NaN })
            .then(() => undefined),
        context,
      ),
    ).rejects.toThrow("strict JSON"),
  );
  expect(storage.commits.length).toBe(commits);
});

describe("Session transaction tables", () => {
  it("takes ownership of table JSON and rejects non-strict values", () =>
    Effect.runPromise(takesOwnershipTable));
});
