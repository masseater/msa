import { defineDoc, defineDocFamily, defineTask, type EntryId, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { documentCopies } from "./session-forks-support.ts";
import {
  context,
  createConversation,
  documentCopyChanges,
  flush,
  openTestSession,
} from "./session-support.ts";

function scopedDocsAndWork() {
  const Copied = defineDoc<{ value: string }>({
    kind: "fork.scope.conversation",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ value: "conversation" }),
  });
  const SessionOnly = defineDoc<{ value: string }>({
    kind: "fork.scope.session",
    version: 1,
    scope: "session",
    initial: () => ({ value: "session" }),
  });
  const TaskOnly = defineDoc<{ value: string }>({
    kind: "fork.scope.task",
    version: 1,
    scope: "task",
    initial: () => ({ value: "task" }),
  });
  const Work = defineTask<null, { phase: "start" }, null>({
    name: "fork.scope.work",
    version: 1,
    initial: () => ({ phase: "start" }),
    phases: { start: () => Promise.resolve() },
    abort: () => Promise.resolve(),
  });
  return { Copied, SessionOnly, TaskOnly, Work };
}

const copiesOnlyConversation = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { Copied, SessionOnly, TaskOnly, Work } = scopedDocsAndWork();
  const { session, storage, publications } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  let forkAt!: EntryId;
  let taskId!: TaskId;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            forkAt = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            taskId = yield* awaited(
              tx.createTask(Work, null, {
                ownership: { kind: "conversation" },
                conversationId: parentId,
              }),
            );
            yield* awaited(tx.doc(Copied, parentId));
            yield* awaited(tx.doc(SessionOnly));
            yield* awaited(tx.doc(TaskOnly, taskId));
          }),
        ),
      context,
    ),
  );
  const child = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  yield* flush;
  const copies = documentCopies(storage.commits.at(-1)!);
  expect(copies.map((write) => write.record.kind)).toEqual([Copied.definition.kind]);
  expect(documentCopyChanges(publications.at(-1)!).map((change) => change.record.kind)).toEqual([
    Copied.definition.kind,
  ]);
  expect(yield* awaited(session.snapshot(Copied, child.id, context))).toEqual({
    value: "conversation",
  });
  expect(yield* awaited(session.snapshot(SessionOnly, context))).toEqual({
    value: "session",
  });
  expect(yield* awaited(session.snapshot(TaskOnly, taskId, context))).toEqual({
    value: "task",
  });
});

describe("Session conversation document forks", () => {
  it("copies only conversation documents, leaving Session and task documents in their original scopes", () =>
    Effect.runPromise(copiesOnlyConversation));
});

const copiesEveryFamilyStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Family = defineDocFamily<{ value: number }, number>({
    kind: "fork.pagination",
    version: 1,
    family: true,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: (seed) => ({ value: seed }),
  });
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const forkAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
          }),
        ),
      context,
    ),
  );
  return { runPromise, Family, session, storage, parentId, forkAt };
});

const copiesEveryFamily = Effect.gen(function* () {
  const { runPromise, Family, session, storage, parentId, forkAt } = yield* copiesEveryFamilyStep1;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              Promise.all(
                Array.from({ length: 260 }, (_, index) =>
                  runPromise(
                    Effect.asVoid(
                      Effect.suspend(() =>
                        awaited(tx.doc(Family, parentId, `member-${index}`, index)),
                      ),
                    ),
                  ),
                ),
              ),
            );
          }),
        ),
      context,
    ),
  );
  const child = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  expect(documentCopies(storage.commits.at(-1)!)).toHaveLength(260);
  expect(yield* awaited(session.snapshot(Family, child.id, "member-0", context))).toEqual({
    value: 0,
  });
  expect(yield* awaited(session.snapshot(Family, child.id, "member-259", context))).toEqual({
    value: 259,
  });
});

describe("Session conversation document forks", () => {
  it("copies every family member across storage scan pages", () =>
    Effect.runPromise(copiesEveryFamily));
});
