import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import ids from "../src/ids.ts";
import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";
import sessionTablesSupport from "./session-tables-support.ts";

const { idFromNumber } = ids;

const { awaited } = effectSupport;
const { context, createConversation, openTestSession } = sessionSupport;
const { WorkTask, createTask, terminal } = sessionTablesSupport;

const expectMissingOwnerRejected = Effect.fn("expectMissingOwnerRejected")(function* (
  session: ReturnType<typeof openTestSession>["session"],
) {
  const missingTaskId = idFromNumber<durableTypes.TaskId>(999);
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
  parentId: durableTypes.ConversationId,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let rejectedChildId: durableTypes.ConversationId | undefined;
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
                  { conversationId: parentId, ownership: { kind: "conversation" } },
                ),
              );
              rejectedChildId = (yield* awaited(
                tx.createConversation({ ownership: { kind: "task", taskId: supervisorId } }),
              )).id;
              tx.setTask({
                abortRequested: true,
                background: false,
                conversationId: parentId,
                id: supervisorId,
                input: { path: "aborting" },
                kind: WorkTask.definition.name,
                state: { checkpoint: { phase: "start" }, status: "pending" },
                version: WorkTask.definition.version,
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
  parentId: durableTypes.ConversationId,
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
                  { conversationId: parentId, ownership: { kind: "conversation" } },
                ),
              );
              yield* awaited(
                tx.createConversation({ ownership: { kind: "task", taskId: supervisorId } }),
              );
              tx.setTask({
                abortRequested: false,
                background: false,
                conversationId: parentId,
                id: supervisorId,
                input: { path: "terminal" },
                kind: WorkTask.definition.name,
                state: {
                  outcome: { result: { ok: true }, status: "completed" },
                  status: "terminal",
                },
                version: WorkTask.definition.version,
              });
            }),
          ),
        context,
      ),
    ).rejects.toThrow("is terminal"),
  );
});

const expectCommittedTerminalOwnerRejected = Effect.fn("expectCommittedTerminalOwnerRejected")(
  function* (
    session: ReturnType<typeof openTestSession>["session"],
    parentId: durableTypes.ConversationId,
  ) {
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
  let movedStagedTaskId: durableTypes.TaskId<{ ok: boolean }> | undefined;
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
                  { conversationId: parentId, ownership: { kind: "conversation" } },
                ),
              );
              movedStagedTaskId = taskId;
              tx.setTask({
                abortRequested: false,
                background: false,
                conversationId: idFromNumber<durableTypes.ConversationId>(998),
                id: taskId,
                input: { path: "move" },
                kind: WorkTask.definition.name,
                state: { checkpoint: { phase: "start" }, status: "pending" },
                version: WorkTask.definition.version,
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
              tx.appendEntry(conversationId, { data: payload, kind: "data" }),
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
      (tx) => tx.appendEntry(conversationId, { data: undefined, kind: "omitted" }),
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
            .appendEntry(conversationId, { data: Number.NaN, kind: "invalid" })
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
