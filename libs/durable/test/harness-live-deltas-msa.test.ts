import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { type CommitPublication, defineTool, LiveDoc, type LiveState } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat, waitFor } from "./chat-support.ts";
import { OUTPUT, live, drive } from "./harness-live-deltas-support.ts";
import { addTool } from "./harness-support.ts";
import { context, documentChanges } from "./session-support.ts";

function recordingChatSetup() {
  // Storage that remembers whether each commit wrote msa.live as a base or a delta.
  const written = new Map<number, "base" | "delta">();
  const live: { liveId?: number } = {};
  class RecordingStorage extends MemoryStorage {
    override async commit(
      writes: Parameters<MemoryStorage["commit"]>[0],
      context: Parameters<MemoryStorage["commit"]>[1],
    ) {
      let kind: "base" | "delta" | undefined;
      for (const write of writes) {
        if (write.type === "document.change" && write.id === live.liveId) kind = write.content.kind;
      }
      const seq = await super.commit(writes, context);
      if (kind !== undefined) written.set(seq, kind);
      return seq;
    }
  }
  const setup = chatSetup();
  for (const name of ["first", "second"]) {
    addTool(
      setup.registry,
      defineTool({
        name,
        description: name,
        parameters: Type.Object({}),
        execute: async (_args, api) => {
          api.output(`${name} output\n`);
          await new Promise((resolve) => {
            setTimeout(resolve, 150);
          });
          api.output(`${name} more\n`);
          return {};
        },
      }),
    );
  }
  setup.faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("first", {}, { id: "a" }), fauxToolCall("second", {}, { id: "b" })],
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  setup.settings.toolExecution = "sequential";
  return { written, live, RecordingStorage, setup };
}

describe("msa.live deltas", () => {
  it("streams partial text as appends", async () => {
    const setup = chatSetup({ tokensPerSecond: 400, tokenSize: { min: 4, max: 4 } });
    setup.faux.setResponses([fauxAssistantMessage([fauxText("word ".repeat(250))])]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const commits: Op[][] = [];
    harness.subscribeCommits((publication) => {
      for (const change of documentChanges(publication)) {
        if (change.record.kind === "msa.live" && change.ops.length > 0)
          commits.push([...change.ops]);
      }
    });
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const partials = commits.slice(2, -1);
    expect(partials.length).toBeGreaterThan(2);
    expect(partials[0]).toEqual([["s", ["generation", "message"], expect.any(Object)]]);
    for (const ops of partials.slice(1)) {
      expect(ops).toEqual([
        ["a", ["generation", "message", "content", 0, "text"], expect.any(String)],
      ]);
    }
    await harness.close(context);
  });

  it("stores a complete base exactly in the commits where nothing runs", async () => {
    const { written, live, RecordingStorage, setup } = recordingChatSetup();
    const { harness, root } = await openChat(new RecordingStorage(), setup);
    const values = new Map<number, LiveState>();
    harness.subscribeCommits((publication) => {
      for (const change of documentChanges(publication)) {
        if (change.record.kind !== "msa.live") continue;
        live.liveId = change.record.id;
        if (change.value !== null) values.set(publication.seq, change.value as LiveState);
      }
    });
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const nothingRuns = (value: LiveState) =>
      value.generation === undefined &&
      !(value.tools ?? []).some((slot) => slot.status === "running");
    const kinds = [...written].map(([seq, kind]) => {
      expect(kind === "base").toBe(nothingRuns(values.get(seq)!));
      return kind;
    });
    // Bases at the handover, after each sequential tool, after the round, and when the run ends.
    expect(kinds.filter((kind) => kind === "base").length).toBeGreaterThanOrEqual(5);
    expect(kinds).toContain("delta");
    await harness.close(context);
  });
});

describe("msa.live deltas", () => {
  it("starts calls the request did not offer as done and marks a faulted tool's slot done without an entry", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      defineTool({
        name: "bad",
        description: "bad",
        parameters: Type.Object({}),
        // Not strict JSON: the result commit throws and the scheduler faults the task.
        execute: () => Promise.resolve({ output: [], details: { fn: (() => 1) as never } }),
      }),
    );
    setup.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("ghost", {}, { id: "g" }), fauxToolCall("bad", {}, { id: "b" })],
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const commits: Op[][] = [];
    harness.subscribeCommits((publication) => {
      for (const change of documentChanges(publication)) {
        if (change.record.kind === "msa.live" && change.ops.length > 0)
          commits.push([...change.ops]);
      }
    });
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const entries = await root.entries({}, 10, undefined, context);
    const ghostResult = entries.items.find((entry) => entry.kind === "msa.tool-result")!.id;
    const handover = commits.find((ops) =>
      ops.some((op) => op[0] === "s" && op[1][0] === "tools"),
    )!;
    expect(handover).toContainEqual([
      "s",
      ["tools"],
      [
        { callId: "g", name: "ghost", status: "done", entry: ghostResult },
        { callId: "b", name: "bad", taskId: expect.any(Number), status: "pending" },
      ],
    ]);
    // The fault cleanup writes only the status.
    expect(commits).toContainEqual([["s", ["tools", 1, "status"], "done"]]);
    await harness.close(context);
  });
});

describe("msa.live deltas", () => {
  it("commits the tool-calling answer, its tool tasks, the generation's wait, and the tool round in one commit", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      defineTool({
        name: "noop",
        description: "noop",
        parameters: Type.Object({}),
        execute: () => Promise.resolve({ output: [] }),
      }),
    );
    setup.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("noop", {}, { id: "a" }), fauxToolCall("noop", {}, { id: "b" })],
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    let handover: CommitPublication | undefined;
    harness.subscribeCommits((publication) => {
      for (const change of documentChanges(publication)) {
        if (
          change.record.kind === "msa.live" &&
          (change.value as LiveState | null)?.tools?.length === 2
        ) {
          handover ??= publication;
        }
      }
    });
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const changes = handover!.changes;
    const kinds = changes.flatMap((change) =>
      change.type === "entry"
        ? [change.value.kind]
        : change.type === "task"
          ? [change.value.kind]
          : [],
    );
    expect(kinds.sort()).toEqual(["msa.assistant", "msa.generation", "msa.tool", "msa.tool"]);
    await harness.close(context);
  });
});

describe("msa.live deltas", () => {
  it("writes an aborted tool's slot with field-level ops", async () => {
    const run = await drive();
    await run.step((api) => api.output("partial\n"));
    await run.step((api) => api.details({ n: 1 }, context));
    const taskId = (await live(run.harness))!.tools![0]!.taskId!;
    const before = run.commits.length;
    await run.harness.abortTask(taskId, context);
    const isAbortCommit = (ops: readonly Op[]) =>
      ops.some(
        (op) => op[0] === "s" && JSON.stringify(op[1]) === JSON.stringify(["tools", 0, "status"]),
      );
    await waitFor(() => run.commits.slice(before).some(isAbortCommit));
    const abortCommit = run.commits.slice(before).find(isAbortCommit)!;
    expect(abortCommit).toEqual(
      expect.arrayContaining([
        ["s", ["tools", 0, "status"], "done"],
        ["s", ["tools", 0, "entry"], expect.any(Number)],
        ["d", OUTPUT],
        ["d", ["tools", 0, "details"]],
      ]),
    );
    expect(abortCommit).toHaveLength(4);
    await run.harness.close(context);
  });

  it("keeps a complete base exactly while nothing runs", () => {
    const base = (value: LiveState) =>
      LiveDoc.definition.checkpointWhen!(value, [], { deltasSinceBase: 1000 } as never);
    const slot = (status: "pending" | "running" | "done") => ({ callId: "c", name: "n", status });
    const run = { taskId: 1 as never, inputs: [] };
    expect(base({})).toBe(true);
    expect(base({ run, generation: { attempt: 1 } })).toBe(false);
    expect(base({ run, tools: [slot("pending"), slot("done")] })).toBe(true);
    expect(base({ run, tools: [slot("done"), slot("running")] })).toBe(false);
    expect(base({ run })).toBe(true);
  });
});
