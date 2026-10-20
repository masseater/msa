import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionForksCases from "./session-forks-cases.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { expectCopiesInto, forkPolicyDocs } = sessionForksCases;
const { context, createConversation, flush, openTestSession } = sessionSupport;

const forkWithEveryPolicyStep1 = Effect.fn("forkWithEveryPolicyStep1")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { AsOf, Current, Initial, AsOfFamily, CurrentFamily } = forkPolicyDocs();
  const { session, storage, publications } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const forkAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const forkAtInner = (yield* awaited(tx.appendEntry(parentId, { kind: "fork-point" })))
              .id;
            (yield* awaited(tx.doc(AsOf, parentId))).value = "as-at-fork";
            (yield* awaited(tx.doc(Current, parentId))).value = "current-at-fork";
            (yield* awaited(tx.doc(Initial, parentId))).value = "parent-only";
            (yield* awaited(tx.doc(AsOfFamily, parentId, "a", "unused"))).value = "family-as-a";
            (yield* awaited(tx.doc(AsOfFamily, parentId, "b", "unused"))).value = "family-as-b";
            (yield* awaited(tx.doc(CurrentFamily, parentId, "a", "unused"))).value =
              "family-current-a";
            return forkAtInner;
          }),
        ),
      context,
    ),
  );
  return {
    AsOf,
    AsOfFamily,
    Current,
    CurrentFamily,
    Initial,
    forkAt,
    parentId,
    publications,
    runPromise,
    session,
    storage,
  };
});

const forkWithEveryPolicyStep2 = Effect.fn("forkWithEveryPolicyStep2")(function* () {
  const {
    runPromise,
    AsOf,
    Current,
    Initial,
    AsOfFamily,
    CurrentFamily,
    session,
    storage,
    publications,
    parentId,
    forkAt,
  } = yield* forkWithEveryPolicyStep1();
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(AsOf, parentId))).value = "as-after-fork";
            (yield* awaited(tx.doc(Current, parentId))).value = "current-when-copied";
            (yield* awaited(tx.doc(AsOfFamily, parentId, "a", "unused"))).value = "family-as-after";
            (yield* awaited(tx.doc(CurrentFamily, parentId, "a", "unused"))).value =
              "family-current-when-copied";
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const documentReads = storage.documentReadCount;
  return {
    AsOf,
    AsOfFamily,
    Current,
    CurrentFamily,
    Initial,
    documentReads,
    forkAt,
    parentId,
    publications,
    session,
    storage,
  };
});

const forkWithEveryPolicy = Effect.fn("forkWithEveryPolicy")(function* () {
  const {
    AsOf,
    Current,
    Initial,
    AsOfFamily,
    CurrentFamily,
    session,
    storage,
    publications,
    parentId,
    forkAt,
    documentReads,
  } = yield* forkWithEveryPolicyStep2();
  const child = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  yield* flush;
  expect(storage.documentReadCount).toBe(documentReads);
  return {
    AsOf,
    AsOfFamily,
    Current,
    CurrentFamily,
    Initial,
    child,
    parentId,
    publications,
    session,
    storage,
  };
});

const expectForkedSnapshots = Effect.fn("expectForkedSnapshots")(function* ({
  AsOf,
  Current,
  Initial,
  AsOfFamily,
  CurrentFamily,
  session,
  child,
}: Effect.Success<ReturnType<typeof forkWithEveryPolicy>>) {
  expect(yield* awaited(session.snapshot(AsOf, child.id, context))).toEqual({
    value: "as-at-fork",
  });
  expect(yield* awaited(session.snapshot(Current, child.id, context))).toEqual({
    value: "current-when-copied",
  });
  expect(yield* awaited(session.snapshot(Initial, child.id, context))).toBeUndefined();
  expect(yield* awaited(session.snapshot(AsOfFamily, child.id, "a", context))).toEqual({
    value: "family-as-a",
  });
  expect(yield* awaited(session.snapshot(AsOfFamily, child.id, "b", context))).toEqual({
    value: "family-as-b",
  });
  expect(yield* awaited(session.snapshot(CurrentFamily, child.id, "a", context))).toEqual({
    value: "family-current-when-copied",
  });
});

const copiesCurrentSingletonStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const forked = yield* forkWithEveryPolicy();
  const { AsOf, Initial, session, storage, publications, parentId, child } = forked;
  yield* expectForkedSnapshots(forked);

  expectCopiesInto({ publications, storage }, child.id, 5);

  const parentRecord = yield* awaited(
    storage.findDocument(
      {
        kind: AsOf.definition.kind,
        scope: { conversationId: parentId, kind: "conversation" },
      },
      "current",
      context,
    ),
  );
  const childRecord = yield* awaited(
    storage.findDocument(
      {
        kind: AsOf.definition.kind,
        scope: { conversationId: child.id, kind: "conversation" },
      },
      "current",
      context,
    ),
  );
  expect(childRecord!.id).not.toBe(parentRecord!.id);

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(AsOf, child.id))).value = "child-independent";
          }),
        ),
      context,
    ),
  );
  return { AsOf, Initial, child, parentId, runPromise, session };
});

const copiesCurrentSingleton = Effect.gen(function* () {
  const { runPromise, AsOf, Initial, session, parentId, child } =
    yield* copiesCurrentSingletonStep1;
  expect(yield* awaited(session.snapshot(AsOf, parentId, context))).toEqual({
    value: "as-after-fork",
  });
  expect(yield* awaited(session.snapshot(AsOf, child.id, context))).toEqual({
    value: "child-independent",
  });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Initial, child.id))).value = "child-created";
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(Initial, child.id, context))).toEqual({
    value: "child-created",
  });
});

describe("Session conversation document forks", () => {
  it("copies as-of and current singleton and family bases while leaving initial documents absent", () =>
    Effect.runPromise(copiesCurrentSingleton));
});
