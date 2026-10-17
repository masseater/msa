import type { Context } from "@msa/chord";
import {
  BACKGROUND_CONTEXT,
  createContextKey,
  withAbortSignal,
  withContextValue,
} from "@msa/chord/context";
import { describe, expect, it } from "vite-plus/test";

import { context, documentChanges, flush, openTestSession } from "./session-support.ts";
import { deferred, createState, StateDoc, type State } from "./session-watches-support.ts";

describe("Session document watches", () => {
  it("never creates an absent document", async () => {
    const { session, storage } = openTestSession();
    const commits = storage.commits.length;
    expect(await session.watchDoc(StateDoc, context)).toBeUndefined();
    expect(storage.commits).toHaveLength(commits);
    expect(storage.mintCount).toBe(0);
  });

  it("keeps the acquisition revision until start and delivers exact committed frames", async () => {
    const { session, publications } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const initial = watch.value;
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 1;
    }, context);
    await flush();
    const firstPublished = documentChanges(publications.at(-1)!)[0]!;
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 2;
    }, context);
    await flush();
    const secondPublished = documentChanges(publications.at(-1)!)[0]!;
    expect(watch.value).toBe(initial);

    let inline = true;
    const deliveries: Array<{ value: Readonly<State> | null; ops: unknown }> = [];
    watch.start((value, ops) => {
      expect(inline).toBe(false);
      expect(watch.value).toBe(value);
      deliveries.push({ value, ops });

      return Promise.resolve();
    });
    inline = false;
    expect(deliveries).toHaveLength(0);
    await flush();
    expect(deliveries.map(({ value }) => value?.value)).toEqual([1, 2]);
    expect(deliveries[0]!.value).toBe(firstPublished.value);
    expect(deliveries[0]!.ops).toBe(firstPublished.ops);
    expect(deliveries[1]!.value).toBe(secondPublished.value);
    expect(deliveries[1]!.ops).toBe(secondPublished.ops);
    expect(initial?.value).toBe(0);
    await watch.stop();
  });
});

describe("Session document watches", () => {
  it("serializes callbacks and buffers exact frames committed while one is in flight", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const entered = deferred();
    const release = deferred();
    const values: number[] = [];
    let active = 0;
    let maxActive = 0;
    watch.start(async (value) => {
      active++;
      maxActive = Math.max(maxActive, active);
      values.push(value?.value ?? -1);
      if (values.length === 1) {
        entered.resolve();
        await release.promise;
      }
      active--;
    });
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 1;
    }, context);
    await entered.promise;
    for await (const value of Array.from({ length: 19 }, (_, i) => 2 + i)) {
      await session.commit(async (tx) => {
        (await tx.doc(StateDoc)).value = value;
      }, context);
    }
    expect(values).toEqual([1]);
    release.resolve();
    await flush();
    expect(maxActive).toBe(1);
    expect(values).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    await watch.stop();
  });
});

describe("Session document watches", () => {
  it("allows a listener to initiate a later Session commit", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const completed = deferred();
    const values: number[] = [];
    watch.start(async (value) => {
      const current = value?.value ?? -1;
      values.push(current);
      if (current === 1) {
        await session.commit(async (tx) => {
          (await tx.doc(StateDoc)).value = 2;
        }, context);
      } else {
        completed.resolve();
      }
    });
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 1;
    }, context);
    await completed.promise;
    expect(values).toEqual([1, 2]);
    await watch.stop();
  });

  it("collapses 101 pending commits to one root replacement", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    for await (const value of Array.from({ length: 101 }, (_, i) => 1 + i)) {
      await session.commit(async (tx) => {
        (await tx.doc(StateDoc)).value = value;
      }, context);
    }
    const deliveries: Array<{ value: number; ops: unknown }> = [];
    watch.start((value, ops) => {
      deliveries.push({ value: value?.value ?? -1, ops });

      return Promise.resolve();
    });
    await flush();
    expect(deliveries).toEqual([{ value: 101, ops: [["r", watch.value]] }]);
    await watch.stop();
  });
});

describe("Session document watches", () => {
  it("never folds the in-flight frame into an overflow reset", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const entered = deferred();
    const release = deferred();
    const deliveries: Array<{ value: number; ops: unknown }> = [];
    watch.start(async (value, ops) => {
      deliveries.push({ value: value?.value ?? -1, ops });
      if (deliveries.length === 1) {
        entered.resolve();
        await release.promise;
      }
    });
    await session.commit(async (tx) => {
      (await tx.doc(StateDoc)).value = 1;
    }, context);
    await entered.promise;
    for await (const value of Array.from({ length: 101 }, (_, i) => 2 + i)) {
      await session.commit(async (tx) => {
        (await tx.doc(StateDoc)).value = value;
      }, context);
    }
    release.resolve();
    await flush();
    expect(deliveries[0]!.value).toBe(1);
    expect(deliveries[1]).toEqual({ value: 102, ops: [["r", watch.value]] });
    expect(deliveries).toHaveLength(2);
    await watch.stop();
  });

  it("folds retirement into an overflow reset and then closes", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    for await (const value of Array.from({ length: 100 }, (_, i) => 1 + i)) {
      await session.commit(async (tx) => {
        (await tx.doc(StateDoc)).value = value;
      }, context);
    }
    await session.commit((tx) => tx.retireDoc(StateDoc), context);
    const deliveries: Array<{ value: Readonly<State> | null; ops: unknown }> = [];
    watch.start((value, ops) => {
      deliveries.push({ value, ops });

      return Promise.resolve();
    });
    expect(await watch.closed).toEqual({ reason: "retired" });
    expect(deliveries).toEqual([{ value: null, ops: [["r", null]] }]);
  });
});

describe("Session document watches", () => {
  it("delivers replayable structural no-op commits instead of suppressing them", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const initial = watch.value;
    await session.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      const first = state.items.shift()!;
      state.items.unshift(first);
    }, context);
    const newest = (await session.snapshot(StateDoc, context))!;
    expect(newest).not.toBe(initial);
    expect(newest).toEqual(initial);
    const batches: unknown[] = [];
    watch.start((value, ops) => {
      expect(value).toBe(newest);
      batches.push(ops);

      return Promise.resolve();
    });
    await flush();
    expect(batches).toHaveLength(1);
    expect((batches[0] as readonly unknown[]).length).toBeGreaterThan(0);
    await watch.stop();
  });
});

describe("Session document watches", () => {
  it("preserves commit Context values without inheriting producer cancellation", async () => {
    const { session } = await createState();
    const watch = (await session.watchDoc(StateDoc, context))!;
    const key = createContextKey<string>("watch-test");
    const parentController = new AbortController();
    const commitContext = withContextValue(
      key,
      "newest-commit",
      withAbortSignal(parentController.signal, BACKGROUND_CONTEXT),
    );
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
    }, commitContext);
    await entered.promise;
    expect(deliveryContext!.value(key)).toBe("newest-commit");
    expect(deliveryContext!.abortSignal).toBeUndefined();
    parentController.abort("caller finished");
    const stopped = watch.stop();
    expect(await stopped).toEqual({ reason: "stopped" });
    expect(deliveryContext!.abortSignal).toBeUndefined();
    release.resolve();
  });
});
