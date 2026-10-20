import { type EntryId, type TaskId, defineDoc, defineDocFamily, defineTask } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import documentCopies from "./session-forks-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { context, createConversation, documentCopyChanges, flush, openTestSession } = sessionSupport;

function scopedDocsAndWork() {
  const Copied = defineDoc<{ value: string }>({
    fork: "current",
    history: "latest",
    initial: () => ({ value: "conversation" }),
    kind: "fork.scope.conversation",
    scope: "conversation",
    version: 1,
  });
  const SessionOnly = defineDoc<{ value: string }>({
    initial: () => ({ value: "session" }),
    kind: "fork.scope.session",
    scope: "session",
    version: 1,
  });
  const TaskOnly = defineDoc<{ value: string }>({
    initial: () => ({ value: "task" }),
    kind: "fork.scope.task",
    scope: "task",
    version: 1,
  });
  const Work = defineTask<null, { phase: "start" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "start" }),
    name: "fork.scope.work",
    phases: { start: () => Promise.resolve() },
    version: 1,
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
                conversationId: parentId,
                ownership: { kind: "conversation" },
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
    family: true,
    fork: "current",
    history: "latest",
    initial: (seed) => ({ value: seed }),
    kind: "fork.pagination",
    scope: "conversation",
    version: 1,
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
  return { Family, forkAt, parentId, runPromise, session, storage };
});

const copiesEveryFamily = Effect.gen(function* () {
  const { runPromise, Family, session, storage, parentId, forkAt } = yield* copiesEveryFamilyStep1;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              Promise.all(
                Array.from({ length: 260 }, (_, index) =>
                  runNested(
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
