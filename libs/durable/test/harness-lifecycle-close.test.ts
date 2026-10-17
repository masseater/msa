import { defineDoc, Harness } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import type { SessionImpl } from "../src/session/session.ts";
import { oneStep, withSignal } from "./harness-lifecycle-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { openTasks } from "./task-support.ts";

// Drop the loaded trackers, so the next acquisition reads Storage on the line.
function unloadDocuments(harness: Harness): Promise<void> {
  return (harness as unknown as SessionImpl).unloadDocuments();
}

async function observedNotes() {
  const Notes = defineDoc<{ text: string }>({
    kind: "test.close-frames",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const storage = new ControlledStorage();
  const { harness } = await openTasks(storage, []);
  const root = await harness.root(context);
  await harness.commit(async (tx) => {
    (await tx.doc(Notes)).text = "before";
  }, context);
  const docState = (await harness.documentState(Notes, context))!;
  const docWatch = (await harness.watchDoc(Notes, context))!;
  const viewState = await root.viewState(context);
  const viewWatch = await root.watch(context);
  const graphState = await harness.taskGraph(context);
  const graphWatch = await harness.watchTaskGraph(context);
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
}

async function countedSubscriptions() {
  const Notes = defineDoc<{ text: string }>({
    kind: "test.cancelled-watch",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const storage = new ControlledStorage();
  const { harness } = await openTasks(storage, []);
  const root = await harness.root(context);
  await harness.commit(async (tx) => {
    (await tx.doc(Notes)).text = "x";
  }, context);
  // Count commit subscriptions of document observers.
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
}

describe("Harness close", () => {
  it("publishes no frame to states and watches from a commit that settles during close", async () => {
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
    } = await observedNotes();

    const held = storage.holdCommits();
    const committing = harness.commit(async (tx) => {
      (await tx.doc(Notes)).text = "during close";
      await tx.appendEntry(root.id, { kind: "note" });
      await tx.createTask(oneStep("test.close-graph"), null, {
        ownership: { kind: "conversation" },
        conversationId: root.id,
      });
    }, context);
    await held.entered;
    const closing = harness.close(context);
    held.release();
    await committing;
    await closing;
    await flush();
    expect(frames).toEqual([]);
    expect(docState.value).toBe(docValue);
    expect(viewState.value).toBe(viewValue);
    expect(graphState.value).toEqual({ tasks: {} });
    expect(await graphWatch.closed).toEqual({ reason: "session_closed" });
    expect(await docWatch.closed).toEqual({ reason: "session_closed" });
    expect(await viewWatch.closed).toEqual({ reason: "session_closed" });
    // The commit itself settled.
    expect(storage.commits.at(-1)).toContainEqual(expect.objectContaining({ type: "entry" }));
  });
});

describe("Harness close", () => {
  it("leaves no subscription behind a watch acquisition cancelled on the line", async () => {
    const { Notes, storage, harness, root, counted } = await countedSubscriptions();

    // Cancel a document watch while its acquisition loads the document on the line.
    await unloadDocuments(harness);
    let find = storage.holdFindDocument();
    let controller = new AbortController();
    const docWatch = harness.watchDoc(Notes, withSignal(controller.signal));
    await find.entered;
    controller.abort(new Error("cancelled"));
    find.release();
    await expect(docWatch).rejects.toThrow("cancelled");
    expect(counted.subscriptions).toBe(0);

    // Cancel a view watch while it builds its mount on the line.
    await unloadDocuments(harness);
    find = storage.holdFindDocument();
    controller = new AbortController();
    const viewWatch = root.watch(withSignal(controller.signal));
    await find.entered;
    controller.abort(new Error("cancelled"));
    find.release();
    await expect(viewWatch).rejects.toThrow("cancelled");
    // No observer kept the mount: the next observer builds a new one, and the one after that another.
    const first = await root.viewState(context);
    const firstValue = first.value;
    first.dispose();
    const second = await root.viewState(context);
    expect(second.value).not.toBe(firstValue);
    second.dispose();
    await harness.close(context);
  });
});
