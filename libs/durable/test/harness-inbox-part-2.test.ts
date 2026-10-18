import { rm } from "node:fs/promises";

import { fauxAssistantMessage, fauxToolCall, Type } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { defineTool, LiveDoc } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, waitFor } from "./chat-support.ts";
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
import { addHooks, addTool } from "./harness-support.ts";
import { context, documentChanges } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("inbox", () => {
  it("keeps an onYield continuation across a queued plain write, with the run's original input", async () => {
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
    const write = await root.submit({ type: "write", entry: queuedNote("w") }, context);
    first.release();
    await input.wait(context);
    const entries = await allEntries(root);
    expect(transcript(entries)).toEqual([
      "msa.user:a",
      "msa.assistant:first",
      "note:w",
      "msa.user:more",
      "msa.assistant:second",
    ]);
    expect(await status(input)).toMatchObject({ status: "done", answer: entries.at(-1)!.id });
    expect(await status(write)).toMatchObject({ status: "done" });
    await harness.close(context);
  });

  it("drops an onYield continuation for a queued reset", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step]);
    addHooks(setup.registry, GenerationTask, { onYield: () => ({ continue: "more" }) });
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    await root.reset(undefined, context);
    first.release();
    await input.wait(context);
    await harness.waitForIdle(context);
    expect(await status(input)).toMatchObject({ status: "done" });
    expect(transcript(await allEntries(root))).toEqual([
      "msa.user:a",
      "msa.assistant:first",
      "msa.reset",
    ]);
    expect(setup.faux.state.callCount).toBe(1);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("adds every steer to the run at the postTools boundary with steeringMode all", async () => {
    const setup = chatSetup();
    const gate = deferred();
    holdTool(setup, gate);
    setup.faux.setResponses([HOLD, answer("after tools"), answer("follow-up")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    setup.settings.steeringMode = "all";
    const input = await root.submit({ type: "input", content: "a" }, context);
    await toolRunning(harness, root);
    const s1 = await root.submit({ type: "input", content: "s1", whenBusy: "steer" }, context);
    const f = await root.submit({ type: "input", content: "f" }, context);
    const s2 = await root.submit({ type: "input", content: "s2", whenBusy: "steer" }, context);
    gate.resolve();
    await f.wait(context);
    const entries = await allEntries(root);
    expect(transcript(entries)).toEqual([
      "msa.user:a",
      "msa.assistant",
      "msa.tool-result",
      "msa.user:s1",
      "msa.user:s2",
      "msa.assistant:after tools",
      "msa.user:f",
      "msa.assistant:follow-up",
    ]);
    const answers = entries.filter((entry) => entry.kind === "msa.assistant");
    for await (const submission of [input, s1, s2]) {
      expect(await status(submission)).toMatchObject({ status: "done", answer: answers[1]!.id });
    }
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("queues an idle steer behind waiting items and places it with the first follow-up in ID order", async () => {
    const setup = chatSetup();
    const failing = gated(
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "invalid request" }),
    );
    setup.faux.setResponses([failing.step, answer("both")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await failing.reached;
    const f = await root.submit({ type: "input", content: "f" }, context);
    failing.release();
    await input.wait(context);
    await harness.waitForIdle(context);
    const steer = await root.submit({ type: "input", content: "s", whenBusy: "steer" }, context);
    const settled = await steer.wait(context);
    expect(await status(f)).toMatchObject({
      status: "done",
      answer: settled.status === "done" && settled.answer,
    });
    expect(transcript(await allEntries(root)).slice(-3)).toEqual([
      "msa.user:f",
      "msa.user:s",
      "msa.assistant:both",
    ]);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("starts a queued follow-up after a terminating round", async () => {
    const setup = chatSetup();
    const gate = deferred();
    holdTool(setup, gate, { output: [], control: { terminate: true } });
    setup.faux.setResponses([HOLD, answer("follow-up")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await toolRunning(harness, root);
    const f = await root.submit({ type: "input", content: "f" }, context);
    gate.resolve();
    await f.wait(context);
    const calling = (await allEntries(root)).find((entry) => entry.kind === "msa.assistant")!;
    expect(await status(input)).toMatchObject({ status: "done", answer: calling.id });
    expect(transcript(await allEntries(root))).toEqual([
      "msa.user:a",
      "msa.assistant",
      "msa.tool-result",
      "msa.user:f",
      "msa.assistant:follow-up",
    ]);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("writes the last handoff in call order and then runs queued follow-ups in the new context", async () => {
    const setup = chatSetup();
    const firstGate = deferred();
    const secondGate = deferred();
    holdTool(setup, firstGate, { output: [], control: { handoff: "one" } });
    addTool(
      setup.registry,
      defineTool({
        name: "later",
        description: "Finishes first",
        parameters: Type.Object({}),
        execute: async () => {
          await secondGate.promise;
          return { output: [], control: { handoff: "two" } };
        },
      }),
    );
    const round = fauxAssistantMessage(
      [fauxToolCall("hold", {}, { id: "c1" }), fauxToolCall("later", {}, { id: "c2" })],
      { stopReason: "toolUse" },
    );
    setup.faux.setResponses([round, answer("follow-up")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await toolRunning(harness, root);
    const f = await root.submit({ type: "input", content: "f" }, context);
    secondGate.resolve();
    await waitFor(
      async () =>
        (await harness.snapshot(LiveDoc, root.id, context))?.tools?.[1]?.status === "done",
    );
    firstGate.resolve();
    await f.wait(context);
    expect(await status(input)).toMatchObject({ status: "done" });
    expect(transcript(await allEntries(root)).slice(-4)).toEqual([
      "msa.tool-result",
      "msa.reset:two",
      "msa.user:f",
      "msa.assistant:follow-up",
    ]);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("leaves the inbox alone when the run's task is aborted", async () => {
    const setup = chatSetup();
    const first = gated(answer("never"));
    setup.faux.setResponses([first.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const f = await root.submit({ type: "input", content: "f" }, context);
    const taskId = (await harness.snapshot(LiveDoc, root.id, context))!.run!.taskId;
    await harness.abortTask(taskId, context);
    expect(await input.wait(context)).toMatchObject({ status: "unanswered", reason: "aborted" });
    await harness.waitForIdle(context);
    expect((await status(f)).status).toBe("queued");
    expect(await inbox(harness, root)).toEqual([[f.id, "followUp"]]);
    await harness.close(context);
  });

  it("returns a queued submission for its repeated request ID without a second item", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const queued = await root.submit({ type: "input", content: "f", requestId: "r" }, context);
    const again = await root.submit({ type: "input", content: "f", requestId: "r" }, context);
    expect(again.id).toBe(queued.id);
    expect(await inbox(harness, root)).toEqual([[queued.id, "followUp"]]);
    await harness.close(context);
  });
});

describe("inbox", () => {
  it("withdraws a middle item with one positional removal", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const items = [];
    for await (const text of ["x", "y", "z"])
      items.push(await root.submit({ type: "input", content: text }, context));
    const ops: Op[][] = [];
    harness.subscribeCommits((publication) => {
      for (const change of documentChanges(publication)) {
        if (change.record.kind === "msa.inbox" && change.ops.length > 0) ops.push([...change.ops]);
      }
    });
    await items[1]!.abort(context);
    expect(ops).toEqual([[["p", ["items"], 1, 1, []]]]);
    expect(await inbox(harness, root)).toEqual([
      [items[0]!.id, "followUp"],
      [items[2]!.id, "followUp"],
    ]);
    await harness.close(context);
  });
});
