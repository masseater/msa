import { fauxAssistantMessage } from "@msa/ai";
import { LiveDoc } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import {
  inboxItems,
  mention,
  answer,
  gated,
  transcript,
  requestLog,
} from "./harness-input-entries-support.ts";
import { addSection } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";
import { makeTempFile, removeDir } from "./temp-support.ts";

describe("data-only writes", () => {
  it("queues a data-only write behind a queued reset, so it lands after the reset and stays visible", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    await root.reset(undefined, context);
    const chat = await root.submit(
      { type: "write", entry: { kind: "chat.message", data: "hi" } },
      context,
    );
    expect((await chat.status(context)).status).toBe("queued");
    first.release();
    await input.wait(context);
    const settled = await chat.wait(context);
    const entries = await allEntries(root);
    const reset = entries.find((entry) => entry.kind === "msa.reset")!;
    expect(settled.status === "done" && settled.entry).toBeGreaterThan(reset.id);
    expect((await root.context(context)).entries.map((entry) => entry.kind)).toEqual([
      "msa.reset",
      "chat.message",
    ]);
    // Once the reset is placed, display-only writes go in at once again.
    const later = await root.submit(
      { type: "write", entry: { kind: "chat.message", data: "again" } },
      context,
    );
    expect((await later.status(context)).status).toBe("done");
    await harness.close(context);
  });
});

describe("data-only writes", () => {
  it("leaves the request unchanged by a data-only write that lands while the generation prepares", async () => {
    const setup = chatSetup();
    const rendering = deferred();
    const render = deferred();
    let renders = 0;
    addSection(setup.registry, "slow", async () => {
      if (renders++ === 1) {
        rendering.resolve();
        await render.promise;
      }
      return "SLOW";
    });
    const requests: string[][] = [];
    setup.faux.setResponses([
      requestLog(requests, answer("one")),
      requestLog(requests, answer("two")),
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await (await root.submit({ type: "input", content: "a" }, context)).wait(context);
    const second = await root.submit({ type: "input", content: "b" }, context);
    await rendering.promise;
    await root.submit({ type: "write", entry: { kind: "chat.message", data: "hi" } }, context);
    render.resolve();
    await second.wait(context);
    expect(requests[1]).toEqual(["system:", "user:a", "assistant:one", "user:b"]);
    const kinds = (await allEntries(root)).map((entry) => entry.kind);
    // The unchanged prompt adds no second msa.system entry.
    expect(kinds).toEqual([
      "msa.user",
      "msa.system",
      "msa.assistant",
      "msa.user",
      "chat.message",
      "msa.assistant",
    ]);
    await harness.close(context);
  });
});

describe("data-only writes", () => {
  it("appends a data-only write while idle after a failed run without placing the queued items", async () => {
    const setup = chatSetup();
    const failing = gated(
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "invalid request" }),
    );
    setup.faux.setResponses([failing.step, answer("for f")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await failing.reached;
    const f = await root.submit({ type: "input", content: "f", entry: mention("f") }, context);
    failing.release();
    expect(await input.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "model_error",
    });
    await harness.waitForIdle(context);
    const note = await root.submit({ type: "write", entry: { kind: "note", data: "n" } }, context);
    expect((await note.status(context)).status).toBe("done");
    await harness.waitForIdle(context);
    expect((await f.status(context)).status).toBe("queued");
    expect((await inboxItems(harness, root)).map((item) => item.id)).toEqual([f.id]);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    expect(setup.faux.state.callCount).toBe(1);
    // The next input places the waiting mention first.
    const g = await root.submit({ type: "input", content: "g" }, context);
    await g.wait(context);
    expect(transcript(await allEntries(root)).filter(([kind]) => kind !== "msa.assistant")).toEqual(
      [
        ["msa.user", "a"],
        ["note", "n"],
        ["chat.mention", { author: "ann", text: "f" }, "f"],
        ["msa.user", "g"],
      ],
    );
    await harness.close(context);
  });
});

describe("data-only writes", () => {
  it("keeps a queued input's entry across reopen and places it as that entry", async () => {
    const { directory, path } = await makeTempFile("msa-durable-input-entries-", "session.sqlite");
    try {
      const setup = chatSetup();
      const first = gated(answer("first"));
      setup.faux.setResponses([first.step, answer("first again"), answer("for f")]);
      let opened = await openChat(await openNodeSqliteStorage(path), setup);
      await opened.root.submit({ type: "input", content: "a" }, context);
      await first.reached;
      const f = (
        await opened.root.submit({ type: "input", content: "f", entry: mention("f") }, context)
      ).id;
      await opened.harness.close(context);

      opened = await openChat(await openNodeSqliteStorage(path), setup);
      expect(
        (await inboxItems(opened.harness, opened.root)).find((item) => item.id === f),
      ).toMatchObject({
        entry: mention("f"),
      });
      const settled = await (await opened.harness.submission(f, context))!.wait(context);
      const placed = (await allEntries(opened.root)).find(
        (entry) => entry.kind === "chat.mention",
      )!;
      expect(settled).toMatchObject({ status: "done", entry: placed.id });
      expect(placed).toMatchObject({
        data: mention("f").data,
        model: [{ role: "user", content: "f" }],
      });
      await opened.harness.close(context);
    } finally {
      await removeDir(directory);
    }
  });
});

describe("data-only writes", () => {
  it("appends a data-only write at once behind a non-empty inbox, and still queues writes with model or edits", async () => {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("second")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const followUp = await root.submit({ type: "input", content: "f" }, context);
    const model = await root.submit(
      {
        type: "write",
        entry: { kind: "note", model: [{ role: "user", content: "m", timestamp: 0 }] },
      },
      context,
    );
    const target = (await allEntries(root)).find((entry) => entry.kind === "msa.user")!;
    const edit = await root.submit(
      { type: "write", entry: { kind: "redact", edits: [{ target: target.id, action: "omit" }] } },
      context,
    );
    const note = await root.submit({ type: "write", entry: { kind: "note", data: "n" } }, context);
    expect((await note.status(context)).status).toBe("done");
    expect((await inboxItems(harness, root)).map((item) => [item.id, item.mode])).toEqual([
      [followUp.id, "followUp"],
      [model.id, "write"],
      [edit.id, "write"],
    ]);
    first.release();
    await followUp.wait(context);
    expect(transcript(await allEntries(root))).toEqual([
      ["msa.user", "a"],
      ["note", "n"],
      ["msa.assistant", "first"],
      ["note", "m"],
      ["redact"],
      ["msa.user", "f"],
      ["msa.assistant", "second"],
    ]);
    expect(await input.status(context)).toMatchObject({ status: "done" });
    await harness.close(context);
  });
});
