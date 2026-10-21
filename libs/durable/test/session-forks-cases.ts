import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { dual } from "effect/Function";
import { expect } from "vite-plus/test";

import type sessionForksCasesTypes from "./session-forks-cases.types.ts";
import documentCopies from "./session-forks-support.ts";
import sessionSupport from "./session-support.ts";

const { defineDoc, defineDocFamily } = durable;

const { documentCopyChanges } = sessionSupport;

function expectCopiesIntoImpl(
  { storage, publications }: Pick<sessionForksCasesTypes.TestSession, "storage" | "publications">,
  childId: durableTypes.ConversationId,
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

const expectCopiesInto: {
  (
    childId: durableTypes.ConversationId,
    count: number,
  ): (session: Pick<sessionForksCasesTypes.TestSession, "storage" | "publications">) => void;
  (
    session: Pick<sessionForksCasesTypes.TestSession, "storage" | "publications">,
    childId: durableTypes.ConversationId,
    count: number,
  ): void;
} = dual(3, expectCopiesIntoImpl);

function forkPolicyDocs() {
  const AsOf = defineDoc<{ value: string }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ value: "as-initial" }),
    kind: "fork.policies.as-of",
    scope: "conversation",
    version: 1,
  });
  const Current = defineDoc<{ value: string }>({
    fork: "current",
    history: "latest",
    initial: () => ({ value: "current-initial" }),
    kind: "fork.policies.current",
    scope: "conversation",
    version: 1,
  });
  const Initial = defineDoc<{ value: string }>({
    fork: "initial",
    history: "latest",
    initial: () => ({ value: "fresh" }),
    kind: "fork.policies.initial",
    scope: "conversation",
    version: 1,
  });
  const AsOfFamily = defineDocFamily<{ value: string }, string>({
    family: true,
    fork: "asOf",
    history: "rewindable",
    initial: (seed) => ({ value: seed }),
    kind: "fork.policies.as-of-family",
    scope: "conversation",
    version: 1,
  });
  const CurrentFamily = defineDocFamily<{ value: string }, string>({
    family: true,
    fork: "current",
    history: "latest",
    initial: (seed) => ({ value: seed }),
    kind: "fork.policies.current-family",
    scope: "conversation",
    version: 1,
  });
  return { AsOf, AsOfFamily, Current, CurrentFamily, Initial };
}

const sessionForksCases = {
  expectCopiesInto,
  forkPolicyDocs,
};

export default sessionForksCases;
