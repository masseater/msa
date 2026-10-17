import type { Context } from "@msa/chord";
import { withCancel } from "@msa/chord/context";
import { applyImmutable } from "@msa/chord/delta";
import { defineDoc } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { context, flush, openTestSession } from "./session-support.ts";
import { deferred, createState, StateDoc, type State } from "./session-watches-support.ts";

describe("Session document watches", () => {
  it("keeps earlier immutable revisions stable", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const initial = watch.value;
    let delivered: Readonly<State> | null | undefined;
    watch.start((value) => {
      delivered = value;

      return Promise.resolve();
    });
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 1;
    }, context);
    await flush();
    expect(delivered).toBe(watch.value);
    expect(delivered).not.toBe(initial);
    expect(delivered?.retained).toBe(initial?.retained);
    expect(initial?.value).toBe(0);
    await watch.stop();
  });

  it("delivers retirement and does not follow recreation", async () => {
    const { session } = await createState();
    const oldWatch = (await session.watchDoc(StateDoc, context))!;
    const values: Array<Readonly<State> | null> = [];
    oldWatch.start((value) => {
      values.push(value);

      return Promise.resolve();
    });
    await session.commit(async (tx) => {
      await tx.retireDoc(StateDoc);
      (await tx.doc(StateDoc)).value = 10;
    }, context);
    expect(await oldWatch.closed).toEqual({ reason: "retired" });
    expect(values).toEqual([null]);
    expect(oldWatch.value).toBeNull();

    const replacement = (await session.watchDoc(StateDoc, context))!;
    expect(replacement.value?.value).toBe(10);
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 11;
    }, context);
    await flush();
    expect(oldWatch.value).toBeNull();
    await replacement.stop();
  });
});

describe("Session document watches", () => {
  it("Session close discards retirement buffered before start", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const baseline = watch.value;
    await session.commit((tx) => tx.retireDoc(StateDoc), context);
    await session.close(context);
    expect(await watch.closed).toEqual({ reason: "session_closed" });
    expect(watch.value).toBe(baseline);
    expect(() => watch.start(() => Promise.resolve(undefined))).toThrow("stopped");
  });

  it("Session close discards retirement behind an in-flight callback", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const entered = deferred();
    const release = deferred();
    const values: Array<number | null> = [];
    watch.start(async (value) => {
      values.push(value?.value ?? null);
      entered.resolve();
      await release.promise;
    });
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 1;
    }, context);
    await entered.promise;
    await session.commit((tx) => tx.retireDoc(StateDoc), context);
    await session.close(context);
    expect(await watch.closed).toEqual({ reason: "session_closed" });
    release.resolve();
    await flush();
    expect(values).toEqual([1]);
  });

  it("supports idempotent stop and rejects repeated or late start", async () => {
    const { session } = await createState();
    const started = (await session.watchDoc(StateDoc, context))!;
    started.start(() => Promise.resolve(undefined));
    expect(() => started.start(() => Promise.resolve(undefined))).toThrow("already started");
    const first = started.stop();
    const second = started.stop();
    expect(second).toBe(first);
    expect(await first).toEqual({ reason: "stopped" });

    const stopped = (await session.watchDoc(StateDoc, context))!;
    await stopped.stop();
    expect(() => stopped.start(() => Promise.resolve(undefined))).toThrow("stopped");
  });
});

describe("Session document watches", () => {
  it("cancels acquisition without leaking a registered watch", async () => {
    const { session, storage } = await createState();
    await session.unloadDocuments();
    const gate = storage.holdFindDocument();
    const child = withCancel(context);
    const acquisition = session.watchDoc(StateDoc, child.context);
    await gate.entered;
    child.cancel(new Error("cancel acquisition"));
    gate.release();
    await expect(acquisition).rejects.toThrow("cancel acquisition");
    await session.close(context);
  });

  it("cancels future delivery without aborting an in-flight callback", async () => {
    const { session } = await createState();
    const child = withCancel(context);
    const watch = (await session.watchDoc(StateDoc, child.context))!;
    const entered = deferred();
    const release = deferred();
    let deliveryContext: Context | undefined;
    watch.start(async (_value, _ops, delivered) => {
      deliveryContext = delivered;
      entered.resolve();
      await release.promise;
    });
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 1;
    }, context);
    await entered.promise;
    child.cancel();
    expect(await watch.closed).toEqual({ reason: "cancelled" });
    expect(deliveryContext!.abortSignal).toBeUndefined();
    release.resolve();
  });
});

describe("Session document watches", () => {
  it("Session close stops future delivery without joining an in-flight callback", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const entered = deferred();
    const release = deferred();
    let deliveryContext: Context | undefined;
    watch.start(async (_value, _ops, delivered) => {
      deliveryContext = delivered;
      entered.resolve();
      await release.promise;
    });
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 1;
    }, context);
    await entered.promise;
    await session.close(context);
    expect(deliveryContext!.abortSignal).toBeUndefined();
    expect(await watch.closed).toEqual({ reason: "session_closed" });
    release.resolve();
  });

  it("settles listener failure on only the affected watch", async () => {
    const { session } = await createState();
    const failed = (await session.watchDoc(StateDoc, context))!;
    const healthy = (await session.watchDoc(StateDoc, context))!;
    failed.start(() => {
      return Promise.reject(new Error("listener failed"));
    });
    let healthyCalls = 0;
    healthy.start(() => {
      healthyCalls++;

      return Promise.resolve();
    });
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 1;
    }, context);
    const end = await failed.closed;
    expect(end.reason).toBe("listener_error");
    if (end.reason === "listener_error") expect(end.error.message).toBe("listener failed");
    await flush();
    expect(healthyCalls).toBe(1);
    await healthy.stop();
  });
});

describe("Session document watches", () => {
  it("hydrates migration without writing and observes the later exact edit", async () => {
    const Old = defineDoc<{ value: number }>({
      kind: "watch.migration",
      version: 1,
      scope: "session",
      initial: () => ({ value: 3 }),
    });
    const Current = defineDoc<{ value: number; migrated: boolean }>({
      kind: "watch.migration",
      version: 2,
      scope: "session",
      initial: () => ({ value: 0, migrated: false }),
      migrate: (value) => ({ value: value["value"] as number, migrated: true }),
    });
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(Old).then(() => undefined), context);
    await session.unloadDocuments();
    const commits = storage.commits.length;
    const watch = (await session.watchDoc(Current, context))!;
    expect(watch.value).toEqual({ value: 3, migrated: true });
    expect(storage.commits).toHaveLength(commits);
    const values: number[] = [];
    watch.start((value) => {
      values.push(value?.value ?? -1);

      return Promise.resolve();
    });
    await session.commit((tx) => tx.doc(Current).then(() => undefined), context);
    await flush();
    expect(values).toEqual([]);
    await session.commit(async (tx) => {
      (await tx.doc(Current)).value = 4;
    }, context);
    await flush();
    expect(values).toEqual([4]);
    await watch.stop();
  });
});

describe("Session document watches", () => {
  it("can replay every delivered exact operation batch from the acquisition revision", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    let replica: Readonly<State> | null = watch.value;
    watch.start((value, ops) => {
      replica = applyImmutable(replica, ops);
      expect(replica).toEqual(value);

      return Promise.resolve();
    });
    await session.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      state.value = 3;
      state.items.splice(0, 1);
    }, context);
    await flush();
    expect(replica).toEqual(watch.value);
    await watch.stop();
  });

  it("continues after the tracker cache unloads", async () => {
    const { session, storage } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const baseline = watch.value;
    const reads = storage.documentReadCount;
    await session.unloadDocuments();
    const reloaded = await session.snapshot(StateDoc, context);
    expect(reloaded).toEqual(baseline);
    expect(reloaded).not.toBe(baseline);
    expect(storage.documentReadCount).toBeGreaterThan(reads);
    watch.start(() => Promise.resolve(undefined));
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 7;
    }, context);
    await flush();
    expect(watch.value?.value).toBe(7);
    await watch.stop();
  });
});
