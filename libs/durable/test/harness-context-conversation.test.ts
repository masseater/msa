import type { Context } from "@msa/chord";
import { type ContextView, type EntryDraft, type EntryId } from "@msa/durable";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  setup,
  countingSetup,
  type Counting,
  type RunRuntime,
  runInRoot,
} from "./harness-context-support.ts";
import { assistant, describeMessage, system, toolResult, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

async function checkExtendedReads(
  { root, first, scanned }: Counting,
  runtime: RunRuntime,
  taskContext: Context,
): Promise<void> {
  const write = (draft: EntryDraft) =>
    runtime.commit(async (tx) => {
      await tx.appendEntry(root.id, draft);
      return undefined;
    }, taskContext);
  const read = async (at?: EntryId): Promise<{ view: ContextView; rows: number }> => {
    const before = scanned.rows;
    const view = await runtime.context(root.id, taskContext, at === undefined ? {} : { at });
    return { view, rows: scanned.rows - before };
  };
  const initial = await read();
  expect(initial.view).toEqual(await root.context(taskContext));

  // Three new entries: the bounds probe reads one row, the extension the three new ones.
  await write({ kind: "message", model: [user("new")] });
  await write({ kind: "note", data: { text: "display only" } });
  await write({ kind: "message", model: [assistant("answer")] });
  const extended = await read();
  expect(extended.rows).toBe(4);
  expect(extended.view).toEqual(await root.context(taskContext));

  // A newer edit of an older entry applies to the extended range.
  await write({ kind: "edit", edits: [{ target: first.id, action: "omit" }] });
  const edited = await read();
  expect(edited.rows).toBe(2);
  expect(edited.view).toEqual(await root.context(taskContext));
  expect(edited.view.messages.map(describeMessage)).not.toContain("user:first");

  // An earlier cutoff reuses the range.
  const cutoff = await read(extended.view.entries.at(-1)!.id);
  expect(cutoff.rows).toBe(0);
  expect(cutoff.view).toEqual(extended.view);

  // A new head marker changes the range: read it whole.
  await write({ kind: "reset", head: "self", model: [user("fresh")] });
  const reset = await read();
  expect(reset.view).toEqual(await root.context(taskContext));
  expect(reset.view.messages.map(describeMessage)).toEqual(["user:fresh"]);
}

async function summaryOverRetainedSystem() {
  const { root, message, append } = await setup();
  const kept = await message(user("kept"));
  await message(assistant("answer"));
  const retained = await message(system({ cwd: "/repo" }), "msa.system");
  // Before generation writes the baseline after the head marker, a retained system entry stays in place.
  await append({ kind: "summary", head: kept.id, model: [user("summary")] });
  await message(user("next"));
  const view = await root.context(context);
  expect(view.messages.map(describeMessage)).toEqual([
    "user:summary",
    "user:kept",
    "assistant:answer",
    "system:cwd",
    "user:next",
  ]);
  return { root, message, append, retained };
}

async function baselineOverRetainedSystem() {
  const { root, message, append, retained } = await summaryOverRetainedSystem();

  // The baseline omits the retained entry, as generation writes it, and leads.
  const baseline = await append({
    kind: "msa.system",
    model: [system({ preamble: "Baseline." })],
    edits: [{ target: retained.id, action: "omit" }],
  });
  await message(assistant("done"));
  await message(system({ preamble: null }), "msa.system");
  return { root, append, baseline };
}

describe("conversation context", () => {
  // #10904
  it("does not lead with a first system entry written after another system message, even once that is omitted", async () => {
    const { root, message, append } = await setup();
    const host = await message(system({ legacy: "Use the legacy format." }), "host.system");
    await message(user("first"));
    await message(assistant("answer"));
    // Generation wrote this entry against the host's message: it only removes a section, so it is no baseline.
    await message(system({ legacy: null }), "msa.system");
    await append({ kind: "edit", edits: [{ target: host.id, action: "omit" }] });
    let view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "user:first",
      "assistant:answer",
      "system:legacy",
    ]);

    // The same holds for a system message an edit put before it.
    const other = await setup();
    const first = await other.message(user("first"));
    await other.append({
      kind: "edit",
      edits: [
        {
          target: first.id,
          action: "replace",
          messages: [user("first"), system({ note: "Note." })],
        },
      ],
    });
    await other.message(assistant("answer"));
    await other.message(system({ note: null }), "msa.system");
    await other.append({
      kind: "edit",
      edits: [{ target: first.id, action: "replace", messages: [user("first")] }],
    });
    view = await other.root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "user:first",
      "assistant:answer",
      "system:note",
    ]);
  });
});

describe("conversation context", () => {
  // #10904
  it("does not lead with a retained, edited, or later system entry in place of the baseline", async () => {
    const { root, append, baseline } = await baselineOverRetainedSystem();
    let view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "system:preamble",
      "user:summary",
      "user:kept",
      "assistant:answer",
      "user:next",
      "assistant:done",
      "system:preamble",
    ]);

    // An omitted baseline leaves no message to lead; the delta after it is not a baseline and stays in place.
    await append({ kind: "edit", edits: [{ target: baseline.id, action: "omit" }] });
    view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "user:summary",
      "user:kept",
      "assistant:answer",
      "user:next",
      "assistant:done",
      "system:preamble",
    ]);

    // A replacement of the baseline is not one either.
    await append({
      kind: "edit",
      edits: [{ target: baseline.id, action: "replace", messages: [system({ other: "Other." })] }],
    });
    view = await root.context(context);
    expect(view.messages.map(describeMessage)).toEqual([
      "user:summary",
      "user:kept",
      "assistant:answer",
      "user:next",
      "system:other",
      "assistant:done",
      "system:preamble",
    ]);
  });
});

describe("conversation context", () => {
  it("synthesizes missing tool results after a fork and drops results cut from their call", async () => {
    const { root, message } = await setup();
    await message(user("go"));
    const call = await message(assistant("calling", { calls: ["x", "y"] }));
    await message(toolResult("x"));
    const second = await message(toolResult("y"));
    const child = await root.fork(call.id, { ownership: { kind: "ownerless" } }, context);
    const childView = await child.context(context);
    expect(childView.messages.map(describeMessage)).toEqual([
      "user:go",
      "assistant:calling",
      "result:x:error",
      "result:y:error",
    ]);
    const missing = childView.messages[2]!;
    expect(missing).toMatchObject({
      role: "toolResult",
      toolName: "tool-x",
      details: { reason: "missing_result" },
    });

    // A head between a call and its results leaves stray results that are not sent.
    await root.commit((tx) => tx.appendEntry(root.id, { kind: "reset", head: second.id }), context);
    const parentView = await root.context(context);
    expect(parentView.messages.map(describeMessage)).toEqual([]);
    expect(parentView.entries.map((entry) => entry.kind)).toEqual(["reset", "message"]);
  });
});

describe("conversation context", () => {
  // #10512
  it("reads the context as of an earlier entry, as a fork at that entry starts", async () => {
    const { root, append, message } = await setup();
    const first = await message(user("first"));
    const call = await message(assistant("calling", { calls: ["x", "y"] }));
    const result = await message(toolResult("x"));
    await message(toolResult("y"));
    const edit = await append({
      kind: "edit",
      edits: [{ target: first.id, action: "replace", messages: [user("first v2")] }],
    });
    const reset = await append({ kind: "reset", head: "self", model: [user("fresh start")] });
    const tail = await message(assistant("after reset"));

    for await (const at of [first, call, result, edit, reset, tail]) {
      const fork = await root.fork(at.id, { ownership: { kind: "ownerless" } }, context);
      expect(await root.context(context, { at: at.id })).toEqual(await fork.context(context));
    }
    // Stepped back before the edit and the reset: neither applies, and a cut call gets synthesized results.
    expect((await root.context(context, { at: call.id })).messages.map(describeMessage)).toEqual([
      "user:first",
      "assistant:calling",
      "result:x:error",
      "result:y:error",
    ]);
    expect(await root.context(context, { at: tail.id })).toEqual(await root.context(context));
    expect(await root.context(context, {})).toEqual(await root.context(context));

    const other = await root.fork(first.id, { ownership: { kind: "ownerless" } }, context);
    await expect(other.context(context, { at: tail.id })).rejects.toThrow("is not visible");
  });

  it("extends a task's context read with only newer entries", async () => {
    const opened = await countingSetup();
    await runInRoot(opened, "test.context-reads", (runtime, taskContext) =>
      checkExtendedReads(opened, runtime, taskContext),
    );
    await opened.harness.close(context);
  });
});
