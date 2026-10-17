import { defineDoc, type JsonObject } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { documentWrites } from "./session-checkpoints-migrations-support.ts";
import { context, documentChanges, flush, openTestSession } from "./session-support.ts";

function rollbackMigrationDocs() {
  const Old = defineDoc<{ count: number }>({
    kind: "migration.rollback",
    version: 1,
    scope: "session",
    initial: () => ({ count: 1 }),
  });
  const calls: { migrations: number } = { migrations: 0 };
  const Current = defineDoc<{ count: number; migrated: boolean }>({
    kind: "migration.rollback",
    version: 2,
    scope: "session",
    initial: () => ({ count: 0, migrated: false }),
    migrate: (value) => {
      calls.migrations++;
      return { count: value["count"] as number, migrated: true };
    },
  });
  return { Old, calls, Current };
}

describe("Session document migrations", () => {
  it("rolls migration and edits back with the callback, then coalesces later edits into one base", async () => {
    const { Old, calls, Current } = rollbackMigrationDocs();
    const { session, storage, publications } = openTestSession();
    await session.commit((tx) => tx.doc(Old).then(() => undefined), context);
    await session.unloadDocuments();
    const commits = storage.commits.length;

    await expect(
      session.commit(async (tx) => {
        (await tx.doc(Current)).count = 8;
        throw new Error("rollback");
      }, context),
    ).rejects.toThrow("rollback");
    expect(storage.commits).toHaveLength(commits);
    expect(await session.snapshot(Current, context)).toEqual({ count: 1, migrated: true });
    expect(calls.migrations).toBe(1);

    await session.commit(async (tx) => {
      const value = await tx.doc(Current);
      value.count = 9;
      value.migrated = false;
    }, context);
    expect(documentWrites(storage.commits.at(-1)!)).toEqual([
      expect.objectContaining({
        type: "document.change",
        content: { kind: "base", version: 2, value: { count: 9, migrated: false } },
      }),
    ]);
    await flush();
    const published = documentChanges(publications.at(-1)!)[0]!;
    const admitted = storage.admittedCommits.at(-1)![0]!;
    if (admitted.type !== "document.change" || admitted.content.kind !== "base") {
      throw new Error("Expected migration base");
    }
    expect(published.value).toBe(await session.snapshot(Current, context));
    expect(published.value).toBe(admitted.content.value);
    expect(published.ops.length).toBeGreaterThan(0);
    expect(calls.migrations).toBe(1);
  });
});

describe("Session document migrations", () => {
  it("strict-checks migration results before tracker ownership and remains usable after rejection", async () => {
    const Old = defineDoc<{ count: number }>({
      kind: "migration.invalid",
      version: 1,
      scope: "session",
      initial: () => ({ count: 1 }),
    });
    const Invalid = defineDoc<JsonObject>({
      kind: "migration.invalid",
      version: 2,
      scope: "session",
      initial: () => ({}),
      migrate: () => ({ invalid: new Date() }) as unknown as JsonObject,
    });
    const Other = defineDoc<{ ok: boolean }>({
      kind: "migration.invalid.other",
      version: 1,
      scope: "session",
      initial: () => ({ ok: true }),
    });
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(Old).then(() => undefined), context);
    await session.unloadDocuments();
    const commits = storage.commits.length;
    await expect(session.snapshot(Invalid, context)).rejects.toThrow("strict JSON");
    await expect(
      session.commit((tx) => tx.doc(Invalid).then(() => undefined), context),
    ).rejects.toThrow("strict JSON");
    expect(storage.commits).toHaveLength(commits);
    await session.commit((tx) => tx.doc(Other).then(() => undefined), context);
    expect(await session.snapshot(Other, context)).toEqual({ ok: true });
  });
});

describe("Session document migrations", () => {
  it("rejects newer stored versions and older versions without migration for snapshots and transactions", async () => {
    const V2 = defineDoc<{ count: number }>({
      kind: "migration.compatibility",
      version: 2,
      scope: "session",
      initial: () => ({ count: 2 }),
    });
    const V1 = defineDoc<{ count: number }>({
      kind: "migration.compatibility",
      version: 1,
      scope: "session",
      initial: () => ({ count: 1 }),
    });
    const V3WithoutMigration = defineDoc<{ count: number }>({
      kind: "migration.compatibility",
      version: 3,
      scope: "session",
      initial: () => ({ count: 3 }),
    });
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(V2).then(() => undefined), context);
    await session.unloadDocuments();
    const commits = storage.commits.length;

    await expect(session.snapshot(V1, context)).rejects.toThrow("newer version 2 than 1");
    await expect(session.commit((tx) => tx.doc(V1).then(() => undefined), context)).rejects.toThrow(
      "newer version 2 than 1",
    );
    await expect(session.snapshot(V3WithoutMigration, context)).rejects.toThrow(
      "requires migration from version 2",
    );
    await expect(
      session.commit((tx) => tx.doc(V3WithoutMigration).then(() => undefined), context),
    ).rejects.toThrow("requires migration from version 2");
    expect(storage.commits).toHaveLength(commits);
  });
});

describe("Session document migrations", () => {
  it("persists a required migration base before retirement without consulting the checkpoint predicate", async () => {
    const Old = defineDoc<{ count: number }>({
      kind: "migration.retire",
      version: 1,
      scope: "session",
      initial: () => ({ count: 1 }),
    });
    const Current = defineDoc<{ count: number }>({
      kind: "migration.retire",
      version: 2,
      scope: "session",
      initial: () => ({ count: 0 }),
      migrate: (value) => ({ count: value["count"] as number }),
      checkpointWhen: () => {
        throw new Error("must not run");
      },
    });
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(Old).then(() => undefined), context);
    await session.unloadDocuments();
    await session.commit(async (tx) => {
      await tx.doc(Current);
      await tx.retireDoc(Current);
    }, context);
    expect(documentWrites(storage.commits.at(-1)!)).toEqual([
      expect.objectContaining({
        type: "document.change",
        content: { kind: "base", version: 2, value: { count: 1 } },
      }),
      expect.objectContaining({ type: "document.retire" }),
    ]);
  });
});

describe("Session document migrations", () => {
  it("leaves unaccessed older documents and unavailable definitions untouched", async () => {
    const FirstV1 = defineDoc<{ count: number }>({
      kind: "migration.lazy.first",
      version: 1,
      scope: "session",
      initial: () => ({ count: 1 }),
    });
    const SecondV1 = defineDoc<{ count: number }>({
      kind: "migration.lazy.second",
      version: 1,
      scope: "session",
      initial: () => ({ count: 2 }),
    });
    let secondMigrations = 0;
    const FirstV2 = defineDoc<{ count: number }>({
      kind: "migration.lazy.first",
      version: 2,
      scope: "session",
      initial: () => ({ count: 0 }),
      migrate: (value) => ({ count: value["count"] as number }),
    });
    defineDoc<{ count: number }>({
      kind: "migration.lazy.second",
      version: 2,
      scope: "session",
      initial: () => ({ count: 0 }),
      migrate: (value) => {
        secondMigrations++;
        return { count: value["count"] as number };
      },
    });
    const { session, storage } = openTestSession();
    await session.commit(async (tx) => {
      await tx.doc(FirstV1);
      await tx.doc(SecondV1);
    }, context);
    await session.unloadDocuments();
    const commits = storage.commits.length;
    expect(await session.snapshot(FirstV2, context)).toEqual({ count: 1 });
    expect(storage.commits).toHaveLength(commits);
    expect(secondMigrations).toBe(0);
    const secondRecord = await storage.findDocument(
      { kind: "migration.lazy.second", scope: { kind: "session" } },
      "current",
      context,
    );
    expect((await storage.document(secondRecord!.id, "current", context))!.version).toBe(1);
  });
});
