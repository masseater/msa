import { type ConversationId, defineDoc, defineDocFamily } from "@msa/durable";
import { dual } from "effect/Function";
import { expect } from "vite-plus/test";

import { documentCopies } from "./session-forks-support.ts";
import { documentCopyChanges, openTestSession } from "./session-support.ts";

export type TestSession = ReturnType<typeof openTestSession>;

function expectCopiesIntoImpl(
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

export const expectCopiesInto: {
  (
    childId: ConversationId,
    count: number,
  ): (session: Pick<TestSession, "storage" | "publications">) => void;
  (
    session: Pick<TestSession, "storage" | "publications">,
    childId: ConversationId,
    count: number,
  ): void;
} = dual(3, expectCopiesIntoImpl);

export function forkPolicyDocs() {
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
