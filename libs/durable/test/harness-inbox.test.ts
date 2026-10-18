import { rm } from "node:fs/promises";

import { type FauxResponseStep } from "@msa/ai";
import { defineDoc, LiveDoc, ResetEntry } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, textOf } from "./chat-support.ts";
import {
  directories,
  toolRunning,
  HOLD,
  holdTool,
  transcript,
  inbox,
  status,
  queuedNote,
  answer,
  gated,
} from "./harness-inbox-support.ts";
import { addHooks } from "./harness-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("inbox", () => {
  it("queues busy submissions and places writes before user items at the final boundary, one follow-up per run", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("second"), answer("third")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const f1 = await root.submit({ type: "input", content: "f1" }, context);
    const write = await root.submit({ type: "write", entry: queuedNote("w") }, context);
    const f2 = await root.submit({ type: "input", content: "f2", whenBusy: "followUp" }, context);
    for await (const submission of [f1, write, f2])
      expect((await status(submission)).status).toBe("queued");
    expect(await inbox(harness, root)).toEqual([
      [f1.id, "followUp"],
      [write.id, "write"],
      [f2.id, "followUp"],
    ]);
    expect(transcript(await allEntries(root))).toEqual(["msa.user:a"]);

    first.release();
    await f2.wait(context);
    expect(transcript(await allEntries(root))).toEqual([
      "msa.user:a",
      "msa.assistant:first",
      "note:w",
      "msa.user:f1",
      "msa.assistant:second",
      "msa.user:f2",
      "msa.assistant:third",
    ]);
    const answers = (await allEntries(root)).filter((entry) => entry.kind === "msa.assistant");
    expect(await status(input)).toMatchObject({ status: "done", answer: answers[0]!.id });
    expect(await status(write)).toMatchObject({ status: "done" });
    expect(await status(f1)).toMatchObject({ status: "done", answer: answers[1]!.id });
    expect(await status(f2)).toMatchObject({ status: "done", answer: answers[2]!.id });
    expect(await inbox(harness, root)).toEqual([]);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("places every follow-up in one successor run with followUpMode all", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("both")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    setup.settings.followUpMode = "all";
    await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const f1 = await root.submit({ type: "input", content: "f1" }, context);
    const f2 = await root.submit({ type: "input", content: "f2" }, context);
    first.release();
    const settled = await f2.wait(context);
    expect(await status(f1)).toEqual({ ...settled, id: f1.id, entry: expect.any(Number) });
    expect(transcript(await allEntries(root))).toEqual([
      "msa.user:a",
      "msa.assistant:first",
      "msa.user:f1",
      "msa.user:f2",
      "msa.assistant:both",
    ]);
    expect(setup.faux.state.callCount).toBe(2);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("reads queue modes when the final boundary's commit runs on the Session line", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("both")]);
    const yielded = deferred();
    addHooks(setup.registry, GenerationTask, { onYield: () => void yielded.resolve() });
    const storage = new ControlledStorage();
    const { harness, root } = await openChat(storage, setup);
    await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const f1 = await root.submit({ type: "input", content: "f1" }, context);
    const f2 = await root.submit({ type: "input", content: "f2" }, context);
    // Occupy the line, let the answer queue its boundary commit behind it, then change the mode.
    const held = storage.holdCommits();
    const Marker = defineDoc<{ n: number }>({
      kind: "test.marker",
      version: 1,
      scope: "session",
      initial: () => ({ n: 0 }),
    });
    const occupying = root.commit(async (tx) => void (await tx.doc(Marker)).n++, context);
    await held.entered;
    first.release();
    await yielded.promise;
    await flush();
    setup.settings.followUpMode = "all";
    held.release();
    await occupying;
    const settled = await f2.wait(context);
    expect(await status(f1)).toEqual({ ...settled, id: f1.id, entry: expect.any(Number) });
    expect(setup.faux.state.callCount).toBe(2);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("adds steers to the run at the postTools boundary and holds follow-ups for the final boundary", async () => {
    const setup = chatSetup();
    const gate = deferred();
    holdTool(setup, gate);
    setup.faux.setResponses([HOLD, answer("after tools"), answer("follow-up")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await toolRunning(harness, root);
    const steer = await root.submit({ type: "input", content: "s", whenBusy: "steer" }, context);
    const followUp = await root.submit({ type: "input", content: "f" }, context);
    gate.resolve();
    await followUp.wait(context);
    expect(transcript(await allEntries(root))).toEqual([
      "msa.user:a",
      "msa.assistant",
      "msa.tool-result",
      "msa.user:s",
      "msa.assistant:after tools",
      "msa.user:f",
      "msa.assistant:follow-up",
    ]);
    const answers = (await allEntries(root)).filter((entry) => entry.kind === "msa.assistant");
    expect(await status(input)).toMatchObject({ status: "done", answer: answers[1]!.id });
    expect(await status(steer)).toMatchObject({ status: "done", answer: answers[1]!.id });
    expect(await status(followUp)).toMatchObject({ status: "done", answer: answers[2]!.id });
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("ends the run at a queued reset after tools and runs earlier follow-ups in the new context", async () => {
    const setup = chatSetup();
    const gate = deferred();
    holdTool(setup, gate);
    const requests: string[][] = [];
    const record: FauxResponseStep = (request) => {
      requests.push(request.messages.map((message) => `${message.role}:${textOf(message) ?? ""}`));
      return answer("fresh");
    };
    setup.faux.setResponses([HOLD, record]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await toolRunning(harness, root);
    const followUp = await root.submit({ type: "input", content: "f" }, context);
    await root.reset(undefined, context);
    gate.resolve();
    await followUp.wait(context);
    expect(await status(input)).toMatchObject({ status: "unanswered", reason: "reset" });
    expect(transcript(await allEntries(root))).toEqual([
      "msa.user:a",
      "msa.assistant",
      "msa.tool-result",
      "msa.reset",
      "msa.user:f",
      "msa.assistant:fresh",
    ]);
    const reset = (await allEntries(root)).find((entry) => ResetEntry.is(entry))!;
    expect(reset.head).toBe(reset.id);
    // The follow-up's request starts at the reset: the complete system baseline after the cut leads the follow-up.
    expect(requests).toEqual([["system:", "user:f"]]);
    expect(setup.faux.state.callCount).toBe(2);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("places a queued reset after the answer at the final boundary", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    await root.reset("handoff", context);
    first.release();
    await input.wait(context);
    await harness.waitForIdle(context);
    expect(await status(input)).toMatchObject({ status: "done" });
    expect(transcript(await allEntries(root))).toEqual([
      "msa.user:a",
      "msa.assistant:first",
      "msa.reset:handoff",
    ]);
    expect((await root.context(context)).messages).toEqual([
      { role: "user", content: "handoff", timestamp: expect.any(Number) },
    ]);
    await harness.close(context);
  });

  it("resets an idle conversation at once, with or without handoff text", async () => {
    const setup = chatSetup();
    setup.now = () => 7;
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    await root.reset(undefined, context);
    let view = await root.context(context);
    expect(view.head?.kind).toBe("msa.reset");
    expect(view.head?.model).toBeUndefined();
    expect(view.messages).toEqual([]);
    await root.reset("carry on", context);
    view = await root.context(context);
    expect(view.head?.head).toBe(view.head?.id);
    expect(view.messages).toEqual([{ role: "user", content: "carry on", timestamp: 7 }]);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("makes a queued head write stale when it targets an entry before the active range", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("second")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const old = await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    await root.reset(undefined, context);
    const reset = (await root.context(context)).head!;
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const stale = await root.submit(
      { type: "write", entry: { kind: "summary", head: old.id } },
      context,
    );
    const fresh = await root.submit(
      { type: "write", entry: { kind: "summary", head: reset.id } },
      context,
    );
    first.release();
    await input.wait(context);
    expect(await status(stale)).toMatchObject({ status: "unanswered", reason: "stale" });
    expect(await status(fresh)).toMatchObject({ status: "done" });
    expect(await inbox(harness, root)).toEqual([]);

    // The fresh summary's marker starts the range at the reset: a target inside the range is not stale, even when
    // it is older than the marker itself. A reset placed earlier in the same boundary makes it stale.
    const inside = (await allEntries(root)).find((entry) => entry.kind === "msa.user")!;
    const second = await root.submit({ type: "input", content: "b" }, context);
    const kept = await root.submit(
      { type: "write", entry: { kind: "summary", head: inside.id } },
      context,
    );
    await second.wait(context);
    expect(await status(kept)).toMatchObject({ status: "done" });
    await harness.close(context);
  });
});
