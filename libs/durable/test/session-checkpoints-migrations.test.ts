import type { Op } from "@msa/chord/delta";
import { defineDoc, type JsonObject, type StorageWrite } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { documentWrites } from "./session-checkpoints-migrations-support.ts";
import { context, documentChanges, flush, openTestSession } from "./session-support.ts";

function checkpointDocs() {
  const calls: { value: Readonly<JsonObject>; ops: readonly Op[] }[] = [];
  const falseCalls: { value: Readonly<JsonObject>; ops: readonly Op[] }[] = [];
  const BaseDoc = defineDoc<{ items: string[] }>({
    kind: "checkpoint.base",
    version: 1,
    scope: "session",
    initial: () => ({ items: [] }),
    checkpointWhen: (value, ops) => {
      calls.push({ value, ops });
      return true;
    },
  });
  const DeltaDoc = defineDoc<{ count: number }>({
    kind: "checkpoint.delta",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: (value, ops) => {
      falseCalls.push({ value, ops });
      return false;
    },
  });
  const DefaultDoc = defineDoc<{ count: number }>({
    kind: "checkpoint.default",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
  });
  return { calls, falseCalls, BaseDoc, DeltaDoc, DefaultDoc };
}

function throwingCheckpointDocs() {
  const state: { throwCheckpoint: boolean; firstCalls: number } = {
    throwCheckpoint: true,
    firstCalls: 0,
  };
  const First = defineDoc<{ count: number }>({
    kind: "checkpoint.rollback.first",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: () => {
      state.firstCalls++;
      return false;
    },
  });
  const Second = defineDoc<{ count: number }>({
    kind: "checkpoint.rollback.second",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: () => {
      if (state.throwCheckpoint) throw new Error("checkpoint failed");
      return false;
    },
  });
  return { state, First, Second };
}

function countingDocVersions() {
  const seen: number[] = [];
  const V1 = defineDoc<{ count: number }>({
    kind: "checkpoint.deltas-since-base",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: (_value, _ops, info) => {
      seen.push(info.deltasSinceBase);
      return info.deltasSinceBase >= 2;
    },
  });
  const V2 = defineDoc<{ count: number }>({
    kind: "checkpoint.deltas-since-base",
    version: 2,
    scope: "session",
    initial: () => ({ count: 0 }),
    migrate: (value) => ({ count: value["count"] as number }),
    checkpointWhen: (_value, _ops, info) => {
      seen.push(info.deltasSinceBase);
      return false;
    },
  });
  return { seen, V1, V2 };
}

describe("Session document checkpoints", () => {
  it("calls checkpointWhen with its definition as the receiver", async () => {
    const Doc = defineDoc<{ count: number }>({
      kind: "checkpoint.receiver",
      version: 1,
      scope: "session",
      initial: () => ({ count: 0 }),
      checkpointWhen(value) {
        return value.count === this.initial().count + 2;
      },
    });
    const { session, storage } = openTestSession();
    for await (const count of [0, 1, 2]) {
      await session.commit(async (tx) => {
        (await tx.doc(Doc)).count = count;
      }, context);
    }
    const kinds = storage.commits.flatMap((writes) =>
      writes.flatMap((write) => (write.type === "document.change" ? [write.content.kind] : [])),
    );
    expect(kinds).toEqual(["delta", "base"]);
  });
});

describe("Session document checkpoints", () => {
  it("selects bases only for nonempty ordinary batches and passes the exact prepared revision and ops", async () => {
    const { calls, falseCalls, BaseDoc, DeltaDoc, DefaultDoc } = checkpointDocs();
    const { session, storage, publications } = openTestSession();

    await session.commit(async (tx) => {
      await tx.doc(BaseDoc);
      await tx.doc(DeltaDoc);
      await tx.doc(DefaultDoc);
    }, context);
    expect(calls).toHaveLength(0);
    expect(falseCalls).toHaveLength(0);
    expect(documentWrites(storage.commits.at(-1)!)).toSatisfy((writes: readonly StorageWrite[]) =>
      writes.every((write) => write.type === "document.create" && write.content.kind === "base"),
    );

    await session.commit(async (tx) => {
      (await tx.doc(BaseDoc)).items.push("x");
      (await tx.doc(DeltaDoc)).count++;
      (await tx.doc(DefaultDoc)).count++;
    }, context);
    await flush();
    const writes = storage.admittedCommits
      .at(-1)!
      .filter((write) => write.type === "document.change");
    expect(writes.map((write) => write.content.kind)).toEqual(["base", "delta", "delta"]);
    expect(calls).toHaveLength(1);
    expect(falseCalls).toHaveLength(1);
    const snapshot = (await session.snapshot(BaseDoc, context))!;
    const deltaSnapshot = (await session.snapshot(DeltaDoc, context))!;
    const [published, publishedDelta] = documentChanges(publications.at(-1)!);
    expect(calls[0]!.value).toBe(snapshot);
    expect(calls[0]!.ops).toBe(published!.ops);
    expect(falseCalls[0]!.value).toBe(deltaSnapshot);
    expect(falseCalls[0]!.ops).toBe(publishedDelta!.ops);
    if (writes[1]!.type !== "document.change" || writes[1]!.content.kind !== "delta") {
      throw new Error("Expected ordinary delta");
    }
    expect(writes[1]!.content.ops).toBe(falseCalls[0]!.ops);
    expect(writes[0]!.type).toBe("document.change");
    if (writes[0]!.type !== "document.change" || writes[0]!.content.kind !== "base") {
      throw new Error("Expected checkpoint base");
    }
    expect(writes[0]!.content.value).toBe(snapshot);
  });
});

describe("Session document checkpoints", () => {
  it("passes the stored delta count since the newest base, including after unload and version bases", async () => {
    const { seen, V1, V2 } = countingDocVersions();
    const { session, storage } = openTestSession();
    const increment = async (token: typeof V1): Promise<void> => {
      await session.commit(async (tx) => {
        (await tx.doc(token)).count++;
      }, context);
    };
    await session.commit((tx) => tx.doc(V1).then(() => undefined), context);
    await increment(V1);
    await increment(V1);
    await increment(V1);
    await session.unloadDocuments();
    await increment(V1);
    expect(seen).toEqual([0, 1, 2, 0]);
    const kinds = storage.commits
      .slice(-4)
      .map((writes) =>
        writes[0]!.type === "document.change" ? writes[0]!.content.kind : writes[0]!.type,
      );
    expect(kinds).toEqual(["delta", "delta", "base", "delta"]);

    // A required version base resets the count without calling the predicate.
    await increment(V2);
    await increment(V2);
    expect(seen).toEqual([0, 1, 2, 0, 0]);
    expect(storage.commits.at(-2)![0]).toMatchObject({ content: { kind: "base", version: 2 } });
  });
});

describe("Session document checkpoints", () => {
  it("skips the predicate for empty batches but calls it for nonempty structural no-ops", async () => {
    let calls = 0;
    const Doc = defineDoc<{ items: string[] }>({
      kind: "checkpoint.no-op",
      version: 1,
      scope: "session",
      initial: () => ({ items: ["a", "b"] }),
      checkpointWhen: () => {
        calls++;
        return false;
      },
    });
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(Doc).then(() => undefined), context);
    const commits = storage.commits.length;

    await session.commit(async (tx) => {
      const value = await tx.doc(Doc);
      value.items.push("x");
      value.items.pop();
    }, context);
    expect(calls).toBe(0);
    expect(storage.commits).toHaveLength(commits);

    await session.commit(async (tx) => {
      const value = await tx.doc(Doc);
      const first = value.items.shift()!;
      value.items.unshift(first);
    }, context);
    expect(calls).toBe(1);
    expect(storage.commits.at(-1)![0]).toMatchObject({
      type: "document.change",
      content: { kind: "delta" },
    });
  });
});

describe("Session document checkpoints", () => {
  it("rolls back every prepared document when a checkpoint predicate throws", async () => {
    const { state, First, Second } = throwingCheckpointDocs();
    const { session, storage, publications } = openTestSession();
    await session.commit(async (tx) => {
      await tx.doc(First);
      await tx.doc(Second);
    }, context);
    await flush();
    const first = (await session.snapshot(First, context))!;
    const second = (await session.snapshot(Second, context))!;
    const commits = storage.commits.length;
    const published = publications.length;

    await expect(
      session.commit(async (tx) => {
        (await tx.doc(First)).count = 1;
        (await tx.doc(Second)).count = 2;
      }, context),
    ).rejects.toThrow("checkpoint failed");
    await flush();
    expect(state.firstCalls).toBe(1);
    expect(storage.commits).toHaveLength(commits);
    expect(publications).toHaveLength(published);
    expect(await session.snapshot(First, context)).toBe(first);
    expect(await session.snapshot(Second, context)).toBe(second);

    state.throwCheckpoint = false;
    await session.commit(async (tx) => {
      (await tx.doc(First)).count = 3;
      (await tx.doc(Second)).count = 4;
    }, context);
    expect(await session.snapshot(First, context)).toEqual({ count: 3 });
    expect(await session.snapshot(Second, context)).toEqual({ count: 4 });
  });
});
