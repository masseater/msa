import { fauxAssistantMessage } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { LiveDoc } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import {
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
import { context, documentChanges } from "./session-support.ts";
import { deferred } from "./task-support.ts";

describe("inbox", () => {
  it("makes a head write stale behind a reset placed earlier in the same boundary", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const target = (await allEntries(root))[0]!;
    await root.reset(undefined, context);
    const summary = await root.submit(
      { type: "write", entry: { kind: "summary", head: target.id } },
      context,
    );
    first.release();
    await input.wait(context);
    expect(await status(summary)).toMatchObject({ status: "unanswered", reason: "stale" });
    await harness.close(context);
  });

  it("ends the run with a msa.reset entry when a tool requests a handoff", async () => {
    const setup = chatSetup();
    const gate = deferred();
    gate.resolve();
    holdTool(setup, gate, { output: [], control: { handoff: "continue here" } });
    setup.faux.setResponses([HOLD]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const settled = await (
      await root.submit({ type: "input", content: "a" }, context)
    ).wait(context);
    const entries = await allEntries(root);
    const calling = entries.find((entry) => entry.kind === "msa.assistant")!;
    expect(settled).toMatchObject({ status: "done", answer: calling.id });
    expect(transcript(entries)).toEqual([
      "msa.user:a",
      "msa.assistant",
      "msa.tool-result",
      "msa.reset:continue here",
    ]);
    expect(entries.at(-1)!.head).toBe(entries.at(-1)!.id);
    expect(setup.faux.state.callCount).toBe(1);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("drops an onYield continuation when the final boundary selects a follow-up", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("second")]);
    let yields = 0;
    addHooks(setup.registry, GenerationTask, {
      onYield: () => (yields++ === 0 ? { continue: "more" } : undefined),
    });
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const followUp = await root.submit({ type: "input", content: "f" }, context);
    first.release();
    await followUp.wait(context);
    expect(await status(input)).toMatchObject({ status: "done" });
    expect(transcript(await allEntries(root))).toEqual([
      "msa.user:a",
      "msa.assistant:first",
      "msa.user:f",
      "msa.assistant:second",
    ]);
    await harness.close(context);
  });

  it("withdraws a queued submission and removes its item", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const kept = await root.submit({ type: "write", entry: queuedNote("kept") }, context);
    const withdrawn = await root.submit({ type: "input", content: "f" }, context);
    expect(await withdrawn.abort(context)).toBe("aborted");
    expect(await withdrawn.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    expect(await inbox(harness, root)).toEqual([[kept.id, "write"]]);
    first.release();
    await input.wait(context);
    expect(await status(kept)).toMatchObject({ status: "done" });
    expect(setup.faux.state.callCount).toBe(1);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("leaves queued items after a failed run until the next submission places them in order", async () => {
    const setup = chatSetup();
    const failing = gated(
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "invalid request" }),
    );
    setup.faux.setResponses([failing.step, answer("for f"), answer("for g")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await failing.reached;
    const f = await root.submit({ type: "input", content: "f" }, context);
    failing.release();
    expect(await input.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "model_error",
    });
    await harness.waitForIdle(context);
    expect((await status(f)).status).toBe("queued");
    expect(await inbox(harness, root)).toEqual([[f.id, "followUp"]]);

    // Idle with a queued item: the new input queues behind it, and a final boundary places the older one first.
    const g = await root.submit({ type: "input", content: "g", whenBusy: "reject" }, context);
    await g.wait(context);
    expect(await status(f)).toMatchObject({ status: "done" });
    expect(transcript(await allEntries(root)).slice(-4)).toEqual([
      "msa.user:f",
      "msa.assistant:for f",
      "msa.user:g",
      "msa.assistant:for g",
    ]);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("commits inbox changes as positional Chord operations and a base when empty", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("second")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const ops: Op[][] = [];
    harness.subscribeCommits((publication) => {
      for (const change of documentChanges(publication)) {
        if (change.record.kind === "msa.inbox" && change.ops.length > 0) ops.push([...change.ops]);
      }
    });
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const w1 = await root.submit({ type: "write", entry: queuedNote("w") }, context);
    const f1 = await root.submit({ type: "input", content: "f1" }, context);
    const w2 = await root.submit({ type: "write", entry: queuedNote("w") }, context);
    const f2 = await root.submit({ type: "input", content: "f2" }, context);
    const w3 = await root.submit({ type: "write", entry: queuedNote("w") }, context);
    expect(ops).toEqual([
      [["p", ["items"], 0, 0, [{ id: w1.id, mode: "write", entry: queuedNote("w") }]]],
      [["p", ["items"], 1, 0, [{ id: f1.id, mode: "followUp", content: "f1" }]]],
      [["p", ["items"], 2, 0, [{ id: w2.id, mode: "write", entry: queuedNote("w") }]]],
      [["p", ["items"], 3, 0, [{ id: f2.id, mode: "followUp", content: "f2" }]]],
      [["p", ["items"], 4, 0, [{ id: w3.id, mode: "write", entry: queuedNote("w") }]]],
    ]);
    first.release();
    await input.wait(context);
    // Every write and the first follow-up leave; only f2 at index 3 remains. No retained value is carried.
    expect(ops[5]!.every((op) => op[0] === "p" && (op[4] as unknown[]).length === 0)).toBe(true);
    expect(ops[5]).toContainEqual(["p", ["items"], 4, 1, []]);
    expect(JSON.stringify(ops[5])).not.toContain("f2");
    await f2.wait(context);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("settles a stale write at once while idle, and a queued one behind waiting items", async () => {
    const setup = chatSetup();
    const failing = gated(
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "invalid request" }),
    );
    setup.faux.setResponses([failing.step, answer("for f")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const old = await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    await root.reset(undefined, context);
    const before = (await allEntries(root)).length;
    const idle = await root.submit(
      { type: "write", entry: { kind: "summary", head: old.id } },
      context,
    );
    expect(await idle.wait(context)).toMatchObject({ status: "unanswered", reason: "stale" });
    expect(await allEntries(root)).toHaveLength(before);

    // After a failed run, a follow-up waits; a stale write queues behind it and the boundary rejects it.
    const input = await root.submit({ type: "input", content: "a" }, context);
    await failing.reached;
    const f = await root.submit({ type: "input", content: "f" }, context);
    failing.release();
    await input.wait(context);
    await harness.waitForIdle(context);
    const queued = await root.submit(
      { type: "write", entry: { kind: "summary", head: old.id } },
      context,
    );
    expect(await queued.wait(context)).toMatchObject({ status: "unanswered", reason: "stale" });
    expect(await f.wait(context)).toMatchObject({ status: "done" });
    await harness.close(context);
  });
});
