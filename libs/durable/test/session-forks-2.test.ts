import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { defineDoc } = durable;

const { awaited } = effectSupport;
const { context, createConversation, openTestSession } = sessionSupport;

const usesFinalDocument = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Doc = defineDoc<{ value: string }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ value: "initial" }),
    kind: "fork.same-commit",
    scope: "conversation",
    version: 1,
  });
  const { session } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  let forkAt!: durableTypes.EntryId;
  const excluded = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            forkAt = (yield* awaited(tx.appendEntry(parentId, { kind: "included" }))).id;
            (yield* awaited(tx.doc(Doc, parentId))).value = "final-state-of-commit";
            const excludedInner = (yield* awaited(tx.appendEntry(parentId, { kind: "excluded" })))
              .id;
            return excludedInner;
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
  expect(yield* awaited(session.snapshot(Doc, child.id, context))).toEqual({
    value: "final-state-of-commit",
  });
  const visible = yield* awaited(
    session.commit((tx) => tx.scanEntries({ conversationId: child.id }, 10), context),
  );
  expect(visible.items.map(({ id }) => id)).toContain(forkAt);
  expect(visible.items.map(({ id }) => id)).not.toContain(excluded);
});

describe("Session conversation document forks", () => {
  it("uses final document state from the fork entry commit while excluding later same-commit entries", () =>
    Effect.runPromise(usesFinalDocument));
});
