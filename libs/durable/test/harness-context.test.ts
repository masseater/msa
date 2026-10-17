import { type EntryId, type EntryRecord } from "@msa/durable";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { setup } from "./harness-context-support.ts";
import { assistant, describeMessage, system, toolResult, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

function ids(entries: readonly EntryRecord[]): EntryId[] {
  return entries.map((entry) => entry.id);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("conversation context", () => {
  it("returns the whole transcript without a head and excludes model-less entries from messages", async () => {
    const { root, append, message } = await setup();
    const first = await message(user("hi"));
    const note = await append({ kind: "note", data: { text: "display only" } });
    const answer = await message(assistant("hello"));
    const view = await root.context(context);
    expect(view.head).toBeUndefined();
    expect(ids(view.entries)).toEqual([first.id, note.id, answer.id]);
    expect(view.messages.map(describeMessage)).toEqual(["user:hi", "assistant:hello"]);
  });

  it("excludes aborted, error, and deferred assistant messages but keeps their raw entries", async () => {
    const { root, message } = await setup();
    await message(user("q"));
    const aborted = await message(assistant("partial", { stopReason: "aborted" }));
    await message(assistant("failed", { stopReason: "error" }));
    await message(assistant("later", { stopReason: "deferred" }));
    await message(assistant("done", { stopReason: "length" }));
    const view = await root.context(context);
    expect(view.entries).toHaveLength(5);
    expect(view.entries[1]!.id).toBe(aborted.id);
    expect(view.messages.map(describeMessage)).toEqual(["user:q", "assistant:done"]);
  });
});

describe("conversation context", () => {
  it("resolves self heads and uses the newest head marker", async () => {
    const { root, append, message } = await setup();
    await message(user("old"));
    const reset = await append({ kind: "reset", head: "self", model: [user("fresh start")] });
    expect(reset.head).toBe(reset.id);
    const after = await message(assistant("after reset"));
    let view = await root.context(context);
    expect(view.head?.id).toBe(reset.id);
    expect(ids(view.entries)).toEqual([reset.id, after.id]);
    expect(view.messages.map(describeMessage)).toEqual([
      "user:fresh start",
      "assistant:after reset",
    ]);

    // A compaction summary heads an earlier kept entry; older head markers in range drop out.
    const summary = await append({ kind: "summary", head: after.id, model: [user("summary")] });
    const tail = await message(user("next"));
    view = await root.context(context);
    expect(view.head?.id).toBe(summary.id);
    expect(ids(view.entries)).toEqual([summary.id, after.id, tail.id]);
    expect(view.messages.map(describeMessage)).toEqual([
      "user:summary",
      "assistant:after reset",
      "user:next",
    ]);
  });
});

describe("conversation context", () => {
  it("applies the newest edit per target within the active range", async () => {
    const { root, append, message } = await setup();
    const first = await message(user("first"));
    const second = await message(user("second"));
    await append({
      kind: "edit",
      edits: [{ target: first.id, action: "replace", messages: [user("first v2")] }],
    });
    await append({
      kind: "edit",
      edits: [{ target: first.id, action: "replace", messages: [user("first v3")] }],
    });
    await append({ kind: "edit", edits: [{ target: second.id, action: "omit" }] });
    let view = await root.context(context);
    expect(view.entries).toHaveLength(5);
    expect(view.messages.map(describeMessage)).toEqual(["user:first v3"]);

    // Edits before the active range no longer apply.
    const reset = await append({ kind: "reset", head: second.id });
    view = await root.context(context);
    expect(view.head?.id).toBe(reset.id);
    expect(view.messages.map(describeMessage)).toEqual([]);
    await append({
      kind: "edit",
      edits: [{ target: second.id, action: "replace", messages: [user("second v2")] }],
    });
    view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual(["user:second v2"]);
  });
});

describe("conversation context", () => {
  it("keeps positional system messages and orders tool results by call order", async () => {
    const { root, message, append } = await setup();
    await message(system({ preamble: "You help." }), "msa.system");
    await message(user("run tools"));
    await message(assistant("calling", { calls: ["b", "a"] }));
    await message(toolResult("a"));
    await append({ kind: "msa.system", model: [system({ cwd: "/repo" })] });
    await message(toolResult("b"));
    await message(toolResult("zz"));
    await message(assistant("done"));
    const view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "system:preamble",
      "user:run tools",
      "assistant:calling",
      "result:b:result b",
      "result:a:result a",
      "system:cwd",
      "assistant:done",
    ]);
  });
});

describe("conversation context", () => {
  // #10542
  it("leads with a system message that only user messages precede, and keeps later ones in place", async () => {
    const { root, message, append } = await setup();
    await message(user("first"));
    await message(user("steered"));
    await message(system({ preamble: "You help." }), "msa.system");
    await message(assistant("answer"));
    await message(user("next"));
    await message(system({ cwd: "/repo" }), "msa.system");
    let view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "system:preamble",
      "user:first",
      "user:steered",
      "assistant:answer",
      "user:next",
      "system:cwd",
    ]);
    // Stored order and contributions stay as committed.
    expect(view.contributions.flat().map(describeMessage).slice(0, 3)).toEqual([
      "user:first",
      "user:steered",
      "system:preamble",
    ]);

    // After a reset, the baseline written after the handoff leads too.
    await append({ kind: "reset", head: "self", model: [user("handoff")] });
    await message(system({ preamble: "Baseline." }), "msa.system");
    view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual(["system:preamble", "user:handoff"]);
  });
});

describe("conversation context", () => {
  // #10904
  it("leads with the baseline after a compaction that keeps assistant messages", async () => {
    const { root, message, append } = await setup();
    await message(user("old"));
    const kept = await message(user("kept"));
    await message(assistant("calling", { calls: ["a"] }));
    await message(toolResult("a"));
    await message(assistant("answer"));
    await append({ kind: "summary", head: kept.id, model: [user("summary")] });
    await message(user("next"));
    await message(system({ preamble: "Baseline." }), "msa.system");
    let view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "system:preamble",
      "user:summary",
      "user:kept",
      "assistant:calling",
      "result:a:result a",
      "assistant:answer",
      "user:next",
    ]);

    // Later system messages stay in place.
    await message(assistant("done"));
    await message(system({ cwd: "/repo" }), "msa.system");
    view = await root.context(context);
    expect(view.messages.map(describeMessage).slice(0, 2)).toEqual([
      "system:preamble",
      "user:summary",
    ]);
    expect(view.messages.map(describeMessage).slice(-2)).toEqual(["assistant:done", "system:cwd"]);
  });

  // #10904
  it("leads with a baseline written after the first answers, when the agent had no section or tool before", async () => {
    const { root, message } = await setup();
    await message(user("first"), "msa.user");
    await message(assistant("answer"), "msa.assistant");
    await message(user("next"), "msa.user");
    await message(system({ plan: "Plan." }), "msa.system");
    const view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "system:plan",
      "user:first",
      "assistant:answer",
      "user:next",
    ]);
  });
});

describe("conversation context", () => {
  // #10904
  it("keeps system messages other than the baseline in place once an assistant message precedes them", async () => {
    const { root, message, append } = await setup();
    await message(user("first"));
    await message(assistant("answer"));
    // Another kind's system message is positional; the baseline after it is not the first system message.
    await message(system({ note: "From here on." }), "host.note");
    await message(system({ preamble: "Baseline." }), "msa.system");
    let view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "user:first",
      "assistant:answer",
      "system:note",
      "system:preamble",
    ]);

    // After a compaction that keeps the other kind's system message, the new baseline does not move ahead of it.
    const kept = await message(user("kept"));
    await message(assistant("kept answer"));
    await message(system({ mode: "plan" }), "host.note");
    await append({ kind: "summary", head: kept.id, model: [user("summary")] });
    await message(user("next"));
    await message(system({ preamble: "Baseline." }), "msa.system");
    view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "user:summary",
      "user:kept",
      "assistant:kept answer",
      "system:mode",
      "user:next",
      "system:preamble",
    ]);
  });
});
