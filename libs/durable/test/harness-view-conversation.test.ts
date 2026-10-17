import { defineDoc, LiveDoc, MemoryStorage } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import { committed, replay, drained, record } from "./harness-view-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

describe("conversation view", () => {
  it("rejects an acquisition cancelled or closed while it waits for the Session line", async () => {
    const { harness, root } = await openChat(new MemoryStorage(), chatSetup());
    const hold = () => {
      const release = deferred();
      const blocking = root.commit(async () => {
        await release.promise;
      }, context);
      return { release: () => release.resolve(), blocking };
    };
    let held = hold();
    const controller = new AbortController();
    const cancelled = root.watch({ ...context, abortSignal: controller.signal });
    controller.abort(new Error("cancelled"));
    held.release();
    await held.blocking;
    await expect(cancelled).rejects.toThrow("cancelled");

    held = hold();
    const closedWhileQueued = root.watch(context);
    const closing = harness.close(context);
    held.release();
    await held.blocking;
    await expect(closedWhileQueued).rejects.toThrow("Harness is closed");
    await closing;
  });

  it("shares one mount between concurrent observers and isolates a failing listener", async () => {
    const { harness, root } = await openChat(new MemoryStorage(), chatSetup());
    const failing = await root.watch(context);
    const { frames, stop } = await record(root);
    const shared = await root.viewState(context);
    expect(failing.value).toBe(shared.value);
    shared.dispose();
    failing.start(() => {
      return Promise.reject(new Error("listener failed"));
    });
    await root.commit((tx) => tx.appendEntry(root.id, { kind: "one" }), context);
    await root.commit((tx) => tx.appendEntry(root.id, { kind: "two" }), context);
    await drained();
    expect(await failing.closed).toMatchObject({ reason: "listener_error" });
    expect(frames).toHaveLength(2);
    await stop();
    await harness.close(context);
  });
});

describe("conversation view", () => {
  it("publishes one frame for a commit that appends several entries and edits a document", async () => {
    const { harness, root } = await openChat(new MemoryStorage(), chatSetup());
    const Other = defineDoc<{ n: number }>({
      kind: "app.other",
      version: 1,
      scope: "conversation",
      history: "latest",
      fork: "initial",
      initial: () => ({ n: 0 }),
    });
    const { initial, frames, stop } = await record(root);
    await root.commit(async (tx) => {
      await tx.appendEntry(root.id, { kind: "a" });
      (await tx.doc(LiveDoc, root.id)).tools = [];
      await tx.appendEntry(root.id, { kind: "b" });
    }, context);
    // A document that is not mounted publishes nothing.
    await root.commit(async (tx) => {
      (await tx.doc(Other, root.id)).n = 1;
    }, context);
    await drained();
    expect(frames).toHaveLength(1);
    expect(frames[0]!.value.entries.map((entry) => entry.kind)).toEqual(["a", "b"]);
    expect(replay(initial, frames)).toEqual(await committed(harness, root, initial.conversation));
    await stop();
    await harness.close(context);
  });
});
