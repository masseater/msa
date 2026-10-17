import { defineDoc } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { documentWrites } from "./session-checkpoints-migrations-support.ts";
import { context, documentChanges, flush, openTestSession } from "./session-support.ts";

describe("Session document checkpoints", () => {
  it("persists repeated false decisions as deltas and replays the complete tail", async () => {
    let calls = 0;
    const Doc = defineDoc<{ values: number[] }>({
      kind: "checkpoint.tail",
      version: 1,
      scope: "session",
      initial: () => ({ values: [] }),
      checkpointWhen: () => {
        calls++;
        return false;
      },
    });
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(Doc).then(() => undefined), context);
    for await (const value of Array.from({ length: 8 }, (_, i) => 1 + i)) {
      await session.commit(async (tx) => {
        (await tx.doc(Doc)).values.push(value);
      }, context);
    }
    const changes = storage.commits.flat().filter((write) => write.type === "document.change");
    expect(changes).toHaveLength(8);
    expect(changes.every((write) => write.content.kind === "delta")).toBe(true);
    expect(calls).toBe(8);
    await session.unloadDocuments();
    expect(await session.snapshot(Doc, context)).toEqual({ values: [1, 2, 3, 4, 5, 6, 7, 8] });
  });
});

describe("Session document checkpoints", () => {
  it("keeps a prepared root replacement as a delta when the predicate is false", async () => {
    const initial: Record<string, number> = {};
    for (let index = 0; index < 4_100; index++) initial[`field${index}`] = 0;
    const Doc = defineDoc<Record<string, number>>({
      kind: "checkpoint.root-replacement",
      version: 1,
      scope: "session",
      initial: () => initial,
      checkpointWhen: () => false,
    });
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(Doc).then(() => undefined), context);
    await session.commit(async (tx) => {
      const value = await tx.doc(Doc);
      for (let index = 0; index < 4_100; index++) value[`field${index}`] = 1;
    }, context);
    const write = storage.commits.at(-1)![0]!;
    expect(write.type).toBe("document.change");
    if (write.type !== "document.change" || write.content.kind !== "delta") {
      throw new Error("Expected root replacement delta");
    }
    expect(write.content.ops).toHaveLength(1);
    expect(write.content.ops[0]![0]).toBe("r");
    await session.unloadDocuments();
    expect((await session.snapshot(Doc, context))!["field4099"]).toBe(1);
  });
});

describe("Session document checkpoints", () => {
  it("uses ordinary checkpoint selection before retirement", async () => {
    let calls = 0;
    const Doc = defineDoc<{ count: number }>({
      kind: "checkpoint.retire",
      version: 1,
      scope: "session",
      initial: () => ({ count: 0 }),
      checkpointWhen: () => {
        calls++;
        return true;
      },
    });
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(Doc).then(() => undefined), context);
    await session.commit(async (tx) => {
      (await tx.doc(Doc)).count = 1;
      await tx.retireDoc(Doc);
    }, context);
    expect(calls).toBe(1);
    expect(documentWrites(storage.commits.at(-1)!)).toEqual([
      expect.objectContaining({
        type: "document.change",
        content: expect.objectContaining({ kind: "base" }),
      }),
      expect.objectContaining({ type: "document.retire" }),
    ]);
  });
});

async function migratedBaseSession() {
  const Old = defineDoc<{ count: number }>({
    kind: "migration.transition",
    version: 1,
    scope: "session",
    initial: () => ({ count: 4 }),
  });
  const calls: { checkpoints: number } = { checkpoints: 0 };
  const Current = defineDoc<{ count: number }>({
    kind: "migration.transition",
    version: 3,
    scope: "session",
    initial: () => ({ count: 0 }),
    migrate: (value, fromVersion) => ({ count: (value["count"] as number) + fromVersion - 1 }),
    checkpointWhen: () => {
      calls.checkpoints++;
      return false;
    },
  });
  const { session, storage, publications } = openTestSession();
  await session.commit((tx) => tx.doc(Old).then(() => undefined), context);
  await session.unloadDocuments();
  return { Old, calls, Current, session, storage, publications };
}

async function watchedMigratedBase() {
  const { Old, calls, Current, session, storage, publications } = await migratedBaseSession();
  // An observer of the older shape.
  const watch = (await session.watchDoc(Old, context))!;
  const frames: unknown[] = [];
  watch.start((value, ops) => {
    frames.push({ value, ops });

    return Promise.resolve();
  });
  return { calls, Current, session, storage, publications, watch, frames };
}

describe("Session document migrations", () => {
  it("migrates read-only once per cold load, copies the callback result, and writes nothing", async () => {
    type CurrentValue = { count: number; labels: string[] };
    const Old = defineDoc<{ count: number }>({
      kind: "migration.read-only",
      version: 1,
      scope: "session",
      initial: () => ({ count: 2 }),
    });
    let calls = 0;
    let retained: CurrentValue | undefined;
    const Current = defineDoc<CurrentValue>({
      kind: "migration.read-only",
      version: 3,
      scope: "session",
      initial: () => ({ count: 0, labels: [] }),
      migrate: (value, fromVersion) => {
        expect(fromVersion).toBe(1);
        calls++;
        retained = { count: value["count"] as number, labels: ["migrated"] };
        return retained;
      },
    });
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(Old).then(() => undefined), context);
    await session.unloadDocuments();
    const commits = storage.commits.length;

    const first = (await session.snapshot(Current, context))!;
    expect(await session.snapshot(Current, context)).toBe(first);
    expect(calls).toBe(1);
    expect(storage.commits).toHaveLength(commits);
    retained!.count = 99;
    retained!.labels.push("mutated");
    expect(first).toEqual({ count: 2, labels: ["migrated"] });

    await session.unloadDocuments();
    const second = (await session.snapshot(Current, context))!;
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    expect(calls).toBe(2);
    expect(storage.commits).toHaveLength(commits);
  });
});

describe("Session document migrations", () => {
  it("writes the required base on the first successful transaction, then writes deltas", async () => {
    const { calls, Current, session, storage, publications, watch, frames } =
      await watchedMigratedBase();
    expect(await session.snapshot(Current, context)).toEqual({ count: 4 });
    const snapshot = await session.snapshot(Current, context);
    // An observer of the new shape: the migration changes nothing it sees.
    const current = (await session.watchDoc(Current, context))!;
    const currentFrames: unknown[] = [];
    current.start((value) => {
      currentFrames.push(value);

      return Promise.resolve();
    });

    await session.commit((tx) => tx.doc(Current).then(() => undefined), context);
    await flush();
    expect(storage.commits.at(-1)![0]).toMatchObject({
      type: "document.change",
      content: { kind: "base", version: 3, value: { count: 4 } },
    });
    expect(calls.checkpoints).toBe(0);
    // The migration-only base is published, so the older-shape watch receives the new value as a root replacement.
    expect(documentChanges(publications.at(-1)!)).toMatchObject([
      { version: 3, value: { count: 4 }, ops: [] },
    ]);
    expect(frames).toEqual([{ value: { count: 4 }, ops: [["r", { count: 4 }]] }]);
    expect(currentFrames).toEqual([]);
    await watch.stop();
    await current.stop();
    expect(await session.snapshot(Current, context)).toBe(snapshot);

    await session.commit(async (tx) => {
      (await tx.doc(Current)).count = 7;
    }, context);
    expect(storage.commits.at(-1)![0]).toMatchObject({
      type: "document.change",
      content: { kind: "delta", version: 3 },
    });
    expect(calls.checkpoints).toBe(1);
    await session.unloadDocuments();
    expect(await session.snapshot(Current, context)).toEqual({ count: 7 });
  });
});
