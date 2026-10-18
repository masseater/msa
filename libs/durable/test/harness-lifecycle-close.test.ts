import { defineDoc } from "@msa/durable";
import { Harness } from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { SessionImpl } from "../src/session/session.ts";
import { abortController, awaited } from "./effect-support.ts";
import { oneStep, withSignal } from "./harness-lifecycle-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { openTasks } from "./task-support.ts";

function unloadDocuments(harness: Harness): Promise<void> {
  return (harness as unknown as SessionImpl).unloadDocuments();
}

const observedNotes = Effect.fn("observedNotes")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Notes = defineDoc<{ text: string }>({
    kind: "test.close-frames",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const storage = new ControlledStorage();
  const { harness } = yield* openTasks(storage, []);
  const root = yield* awaited(harness.root(context));
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes))).text = "before";
          }),
        ),
      context,
    ),
  );
  const docState = (yield* awaited(harness.documentState(Notes, context)))!;
  const docWatch = (yield* awaited(harness.watchDoc(Notes, context)))!;
  const viewState = yield* awaited(root.viewState(context));
  const viewWatch = yield* awaited(root.watch(context));
  const graphState = yield* awaited(harness.taskGraph(context));
  const graphWatch = yield* awaited(harness.watchTaskGraph(context));
  const frames: string[] = [];
  graphState.subscribe((_value, _context, delivery) => {
    if (delivery.kind === "update") frames.push("graphState");
  });
  graphWatch.start(() => Promise.resolve(void frames.push("graphWatch")));
  docState.subscribe((_value, _context, delivery) => {
    if (delivery.kind === "update") frames.push("docState");
  });
  viewState.subscribe((_value, _context, delivery) => {
    if (delivery.kind === "update") frames.push("viewState");
  });
  docWatch.start(() => Promise.resolve(void frames.push("docWatch")));
  viewWatch.start(() => Promise.resolve(void frames.push("viewWatch")));
  const docValue = docState.value;
  const viewValue = viewState.value;
  return {
    Notes,
    storage,
    harness,
    root,
    docState,
    docWatch,
    viewState,
    viewWatch,
    graphState,
    graphWatch,
    frames,
    docValue,
    viewValue,
  };
});

const countedSubscriptions = Effect.fn("countedSubscriptions")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Notes = defineDoc<{ text: string }>({
    kind: "test.cancelled-watch",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const storage = new ControlledStorage();
  const { harness } = yield* openTasks(storage, []);
  const root = yield* awaited(harness.root(context));
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes))).text = "x";
          }),
        ),
      context,
    ),
  );
  const counted: { subscriptions: number } = { subscriptions: 0 };
  const subscribe = harness.subscribeCommits.bind(harness);
  harness.subscribeCommits = (listener) => {
    counted.subscriptions++;
    const unsubscribe = subscribe(listener);
    let active = true;
    return () => {
      if (active) counted.subscriptions--;
      active = false;
      unsubscribe();
    };
  };
  return { Notes, storage, harness, root, counted };
});

const publishesNoFrame = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const {
    Notes,
    storage,
    harness,
    root,
    docState,
    docWatch,
    viewState,
    viewWatch,
    graphState,
    graphWatch,
    frames,
    docValue,
    viewValue,
  } = yield* observedNotes();

  const held = storage.holdCommits();
  const committing = harness.commit(
    (tx) =>
      runPromise(
        Effect.gen(function* () {
          (yield* awaited(tx.doc(Notes))).text = "during close";
          yield* awaited(tx.appendEntry(root.id, { kind: "note" }));
          yield* awaited(
            tx.createTask(oneStep("test.close-graph"), null, {
              ownership: { kind: "conversation" },
              conversationId: root.id,
            }),
          );
        }),
      ),
    context,
  );
  yield* awaited(held.entered);
  const closing = harness.close(context);
  held.release();
  yield* awaited(committing);
  yield* awaited(closing);
  yield* flush;
  expect(frames).toEqual([]);
  expect(docState.value).toBe(docValue);
  expect(viewState.value).toBe(viewValue);
  expect(graphState.value).toEqual({ tasks: {} });
  expect(yield* awaited(graphWatch.closed)).toEqual({ reason: "session_closed" });
  expect(yield* awaited(docWatch.closed)).toEqual({ reason: "session_closed" });
  expect(yield* awaited(viewWatch.closed)).toEqual({ reason: "session_closed" });
  expect(storage.commits.at(-1)).toContainEqual(expect.objectContaining({ type: "entry" }));
});

describe("Harness close", () => {
  it("publishes no frame to states and watches from a commit that settles during close", () =>
    Effect.runPromise(publishesNoFrame));
});

const leavesNoSubscription = Effect.gen(function* () {
  const { Notes, storage, harness, root, counted } = yield* countedSubscriptions();

  yield* awaited(unloadDocuments(harness));
  let find = storage.holdFindDocument();
  let controller = abortController();
  const docWatch = harness.watchDoc(Notes, withSignal(controller.signal));
  yield* awaited(find.entered);
  controller.abort(new Error("cancelled"));
  find.release();
  yield* awaited(expect(docWatch).rejects.toThrow("cancelled"));
  expect(counted.subscriptions).toBe(0);

  yield* awaited(unloadDocuments(harness));
  find = storage.holdFindDocument();
  controller = abortController();
  const viewWatch = root.watch(withSignal(controller.signal));
  yield* awaited(find.entered);
  controller.abort(new Error("cancelled"));
  find.release();
  yield* awaited(expect(viewWatch).rejects.toThrow("cancelled"));
  const first = yield* awaited(root.viewState(context));
  const firstValue = first.value;
  first.dispose();
  const second = yield* awaited(root.viewState(context));
  expect(second.value).not.toBe(firstValue);
  second.dispose();
  yield* awaited(harness.close(context));
});

describe("Harness close", () => {
  it("leaves no subscription behind a watch acquisition cancelled on the line", () =>
    Effect.runPromise(leavesNoSubscription));
});
