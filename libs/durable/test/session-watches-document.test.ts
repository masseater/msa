import type { Context } from "@msa/chord";
import { withCancel } from "@msa/chord/context";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context, flush } from "./session-support.ts";
import {
  StateDoc,
  createState,
  deferred,
  type State,
  writeState,
} from "./session-watches-support.ts";

const keepsEarlierImmutable = Effect.gen(function* () {
  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const initial = watch.value;
  let delivered: Readonly<State> | null | undefined;
  watch.start((value) => {
    delivered = value;

    return Promise.resolve();
  });
  yield* writeState(session, (state) => {
    state.value = 1;
  });
  yield* flush;
  expect(delivered).toBe(watch.value);
  expect(delivered).not.toBe(initial);
  expect(delivered?.retained).toBe(initial?.retained);
  expect(initial?.value).toBe(0);
  yield* awaited(watch.stop());
});

const deliversRetirementDoes = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const oldWatch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const values: Array<Readonly<State> | null> = [];
  oldWatch.start((value) => {
    values.push(value);

    return Promise.resolve();
  });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(tx.retireDoc(StateDoc));
            (yield* awaited(tx.doc(StateDoc))).value = 10;
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(oldWatch.closed)).toEqual({ reason: "retired" });
  expect(values).toEqual([null]);
  expect(oldWatch.value).toBeNull();

  const replacement = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  expect(replacement.value?.value).toBe(10);
  yield* writeState(session, (state) => {
    state.value = 11;
  });
  yield* flush;
  expect(oldWatch.value).toBeNull();
  yield* awaited(replacement.stop());
});

describe("Session document watches", () => {
  it("keeps earlier immutable revisions stable", () => Effect.runPromise(keepsEarlierImmutable));

  it("delivers retirement and does not follow recreation", () =>
    Effect.runPromise(deliversRetirementDoes));
});

const sessionCloseDiscards = Effect.gen(function* () {
  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const baseline = watch.value;
  yield* awaited(session.commit((tx) => tx.retireDoc(StateDoc), context));
  yield* awaited(session.close(context));
  expect(yield* awaited(watch.closed)).toEqual({ reason: "session_closed" });
  expect(watch.value).toBe(baseline);
  expect(() => watch.start(() => Promise.resolve(undefined))).toThrow("stopped");
});

const sessionCloseDiscardsRetirement = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const entered = deferred();
  const release = deferred();
  const values: Array<number | null> = [];
  watch.start((value) =>
    runPromise(
      Effect.gen(function* () {
        values.push(value?.value ?? null);
        entered.resolve();
        yield* awaited(release.promise);
      }),
    ),
  );
  yield* writeState(session, (state) => {
    state.value = 1;
  });
  yield* awaited(entered.promise);
  yield* awaited(session.commit((tx) => tx.retireDoc(StateDoc), context));
  yield* awaited(session.close(context));
  expect(yield* awaited(watch.closed)).toEqual({ reason: "session_closed" });
  release.resolve();
  yield* flush;
  expect(values).toEqual([1]);
});

const supportsIdempotentStop = Effect.gen(function* () {
  const { session } = yield* createState();
  const started = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  started.start(() => Promise.resolve(undefined));
  expect(() => started.start(() => Promise.resolve(undefined))).toThrow("already started");
  const first = started.stop();
  const second = started.stop();
  expect(second).toBe(first);
  expect(yield* awaited(first)).toEqual({ reason: "stopped" });

  const stopped = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  yield* awaited(stopped.stop());
  expect(() => stopped.start(() => Promise.resolve(undefined))).toThrow("stopped");
});

describe("Session document watches", () => {
  it("Session close discards retirement buffered before start", () =>
    Effect.runPromise(sessionCloseDiscards));

  it("Session close discards retirement behind an in-flight callback", () =>
    Effect.runPromise(sessionCloseDiscardsRetirement));

  it("supports idempotent stop and rejects repeated or late start", () =>
    Effect.runPromise(supportsIdempotentStop));
});

const cancelsAcquisitionWithout = Effect.gen(function* () {
  const { session, storage } = yield* createState();
  yield* awaited(session.unloadDocuments());
  const gate = storage.holdFindDocument();
  const child = withCancel(context);
  const acquisition = session.watchDoc(StateDoc, child.context);
  yield* awaited(gate.entered);
  child.cancel(new Error("cancel acquisition"));
  gate.release();
  yield* awaited(expect(acquisition).rejects.toThrow("cancel acquisition"));
  yield* awaited(session.close(context));
});

const cancelsFutureDelivery = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const child = withCancel(context);
  const watch = (yield* awaited(session.watchDoc(StateDoc, child.context)))!;
  const entered = deferred();
  const release = deferred();
  let deliveryContext: Context | undefined;
  watch.start((_value, _ops, delivered) =>
    runPromise(
      Effect.gen(function* () {
        deliveryContext = delivered;
        entered.resolve();
        yield* awaited(release.promise);
      }),
    ),
  );
  yield* writeState(session, (state) => {
    state.value = 1;
  });
  yield* awaited(entered.promise);
  child.cancel();
  expect(yield* awaited(watch.closed)).toEqual({ reason: "cancelled" });
  expect(deliveryContext!.abortSignal).toBeUndefined();
  release.resolve();
});

describe("Session document watches", () => {
  it("cancels acquisition without leaking a registered watch", () =>
    Effect.runPromise(cancelsAcquisitionWithout));

  it("cancels future delivery without aborting an in-flight callback", () =>
    Effect.runPromise(cancelsFutureDelivery));
});
