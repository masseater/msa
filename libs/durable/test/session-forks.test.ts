import { type ConversationId, defineDoc, defineDocFamily, type EntryId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { documentCopies } from "./session-forks-support.ts";
import {
  context,
  createConversation,
  documentCopyChanges,
  flush,
  openTestSession,
} from "./session-support.ts";

type TestSession = ReturnType<typeof openTestSession>;

// The last commit copied `count` documents into `childId`, and published each copy with its source.
function expectCopiesInto(
  { storage, publications }: Pick<TestSession, "storage" | "publications">,
  childId: ConversationId,
  count: number,
): void {
  const copies = documentCopies(storage.admittedCommits.at(-1)!);
  expect(copies).toHaveLength(count);
  expect(copies.every((write) => write.record.scope.kind === "conversation")).toBe(true);
  expect(
    copies.every(
      (write) =>
        write.record.scope.kind === "conversation" && write.record.scope.conversationId === childId,
    ),
  ).toBe(true);
  const publication = publications.at(-1)!;
  const copied = documentCopyChanges(publication);
  expect(copied).toHaveLength(count);
  for (const change of copied) {
    expect(change.record.createdAt).toBe(publication.seq);
    expect(change.conversationId).toBe(childId);
    const write = copies.find((candidate) => candidate.record.id === change.record.id)!;
    expect(change.source).toEqual(write.source);
  }
}

function forkPolicyDocs() {
  const AsOf = defineDoc<{ value: string }>({
    kind: "fork.policies.as-of",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "as-initial" }),
  });
  const Current = defineDoc<{ value: string }>({
    kind: "fork.policies.current",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ value: "current-initial" }),
  });
  const Initial = defineDoc<{ value: string }>({
    kind: "fork.policies.initial",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ value: "fresh" }),
  });
  const AsOfFamily = defineDocFamily<{ value: string }, string>({
    kind: "fork.policies.as-of-family",
    version: 1,
    family: true,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: (seed) => ({ value: seed }),
  });
  const CurrentFamily = defineDocFamily<{ value: string }, string>({
    kind: "fork.policies.current-family",
    version: 1,
    family: true,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: (seed) => ({ value: seed }),
  });
  return { AsOf, Current, Initial, AsOfFamily, CurrentFamily };
}

async function forkWithEveryPolicy() {
  const { AsOf, Current, Initial, AsOfFamily, CurrentFamily } = forkPolicyDocs();
  const { session, storage, publications } = openTestSession();
  const parentId = await createConversation(session);
  let forkAt!: EntryId;
  await session.commit(async (tx) => {
    forkAt = (await tx.appendEntry(parentId, { kind: "fork-point" })).id;
    (await tx.doc(AsOf, parentId)).value = "as-at-fork";
    (await tx.doc(Current, parentId)).value = "current-at-fork";
    (await tx.doc(Initial, parentId)).value = "parent-only";
    (await tx.doc(AsOfFamily, parentId, "a", "unused")).value = "family-as-a";
    (await tx.doc(AsOfFamily, parentId, "b", "unused")).value = "family-as-b";
    (await tx.doc(CurrentFamily, parentId, "a", "unused")).value = "family-current-a";
  }, context);
  await session.commit(async (tx) => {
    (await tx.doc(AsOf, parentId)).value = "as-after-fork";
    (await tx.doc(Current, parentId)).value = "current-when-copied";
    (await tx.doc(AsOfFamily, parentId, "a", "unused")).value = "family-as-after";
    (await tx.doc(CurrentFamily, parentId, "a", "unused")).value = "family-current-when-copied";
  }, context);
  await flush();
  const documentReads = storage.documentReadCount;

  const child = await session.commit(
    (tx) => tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
    context,
  );
  await flush();
  expect(storage.documentReadCount).toBe(documentReads);
  return {
    AsOf,
    Current,
    Initial,
    AsOfFamily,
    CurrentFamily,
    session,
    storage,
    publications,
    parentId,
    child,
  };
}

// The child holds the as-of and current copies, and no initial document.
async function expectForkedSnapshots({
  AsOf,
  Current,
  Initial,
  AsOfFamily,
  CurrentFamily,
  session,
  child,
}: Awaited<ReturnType<typeof forkWithEveryPolicy>>): Promise<void> {
  expect(await session.snapshot(AsOf, child.id, context)).toEqual({ value: "as-at-fork" });
  expect(await session.snapshot(Current, child.id, context)).toEqual({
    value: "current-when-copied",
  });
  expect(await session.snapshot(Initial, child.id, context)).toBeUndefined();
  expect(await session.snapshot(AsOfFamily, child.id, "a", context)).toEqual({
    value: "family-as-a",
  });
  expect(await session.snapshot(AsOfFamily, child.id, "b", context)).toEqual({
    value: "family-as-b",
  });
  expect(await session.snapshot(CurrentFamily, child.id, "a", context)).toEqual({
    value: "family-current-when-copied",
  });
}

describe("Session conversation document forks", () => {
  it("copies as-of and current singleton and family bases while leaving initial documents absent", async () => {
    const forked = await forkWithEveryPolicy();
    const { AsOf, Initial, session, storage, publications, parentId, child } = forked;
    await expectForkedSnapshots(forked);

    expectCopiesInto({ storage, publications }, child.id, 5);

    const parentRecord = await storage.findDocument(
      { kind: AsOf.definition.kind, scope: { kind: "conversation", conversationId: parentId } },
      "current",
      context,
    );
    const childRecord = await storage.findDocument(
      { kind: AsOf.definition.kind, scope: { kind: "conversation", conversationId: child.id } },
      "current",
      context,
    );
    expect(childRecord!.id).not.toBe(parentRecord!.id);

    await session.commit(async (tx) => {
      (await tx.doc(AsOf, child.id)).value = "child-independent";
    }, context);
    expect(await session.snapshot(AsOf, parentId, context)).toEqual({ value: "as-after-fork" });
    expect(await session.snapshot(AsOf, child.id, context)).toEqual({ value: "child-independent" });
    await session.commit(async (tx) => {
      (await tx.doc(Initial, child.id)).value = "child-created";
    }, context);
    expect(await session.snapshot(Initial, child.id, context)).toEqual({ value: "child-created" });
  });
});

describe("Session conversation document forks", () => {
  it("uses final document state from the fork entry commit while excluding later same-commit entries", async () => {
    const Doc = defineDoc<{ value: string }>({
      kind: "fork.same-commit",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "asOf",
      initial: () => ({ value: "initial" }),
    });
    const { session } = openTestSession();
    const parentId = await createConversation(session);
    let forkAt!: EntryId;
    let excluded!: EntryId;
    await session.commit(async (tx) => {
      forkAt = (await tx.appendEntry(parentId, { kind: "included" })).id;
      (await tx.doc(Doc, parentId)).value = "final-state-of-commit";
      excluded = (await tx.appendEntry(parentId, { kind: "excluded" })).id;
    }, context);
    const child = await session.commit(
      (tx) => tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
      context,
    );
    expect(await session.snapshot(Doc, child.id, context)).toEqual({
      value: "final-state-of-commit",
    });
    const visible = await session.commit(
      (tx) => tx.scanEntries({ conversationId: child.id }, 10),
      context,
    );
    expect(visible.items.map(({ id }) => id)).toContain(forkAt);
    expect(visible.items.map(({ id }) => id)).not.toContain(excluded);
  });
});
