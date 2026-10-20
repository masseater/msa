import { Type, fauxAssistantMessage, fauxText, fauxToolCall } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { type CommitPublication, LiveDoc, type LiveState, defineTool } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessLiveDeltasSupport from "./harness-live-deltas-support.ts";
import support from "./support.ts";

const { OUTPUT, drive, live } = harnessLiveDeltasSupport;
const { addTool, awaited, chatSetup, context, documentChanges, openChat, waitFor } = support;

const slowOutputTool = (name: string) =>
  defineTool({
    description: name,
    execute: (_args, api) =>
      Effect.runPromise(
        Effect.gen(function* () {
          api.output(`${name} output\n`);
          yield* Effect.sleep(150);
          api.output(`${name} more\n`);
          return {};
        }),
      ),
    name,
    parameters: Type.Object({}),
  });

function recordingChatSetup() {
  const written = new Map<number, "base" | "delta">();
  const liveInner2: { liveId?: number } = {};
  class RecordingStorage extends MemoryStorage {
    override commit(
      writes: Parameters<MemoryStorage["commit"]>[0],
      contextInner: Parameters<MemoryStorage["commit"]>[1],
    ) {
      const superCommit = super.commit.bind(this);
      return Effect.runPromise(
        Effect.gen(function* () {
          let kind: "base" | "delta" | undefined;
          for (const write of writes) {
            if (write.type === "document.change" && write.id === liveInner2.liveId)
              kind = write.content.kind;
          }
          const seq = yield* awaited(superCommit(writes, contextInner));
          if (kind !== undefined) written.set(seq, kind);
          return seq;
        }),
      );
    }
  }
  const setup = chatSetup();
  for (const name of ["first", "second"]) addTool(setup.registry, slowOutputTool(name));
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
  return { RecordingStorage, live: liveInner2, setup, written };
}

const streamsPartialText = Effect.gen(function* () {
  const setup = chatSetup({ tokenSize: { max: 4, min: 4 }, tokensPerSecond: 400 });
  setup.faux.setResponses([fauxAssistantMessage([fauxText("word ".repeat(250))])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const commits: Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.live" && change.ops.length > 0) commits.push([...change.ops]);
    }
  });
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const partials = commits.slice(2, -1);
  expect(partials.length).toBeGreaterThan(2);
  expect(partials[0]).toEqual([["s", ["generation", "message"], expect.any(Object)]]);
  for (const ops of partials.slice(1)) {
    expect(ops).toEqual([
      ["a", ["generation", "message", "content", 0, "text"], expect.any(String)],
    ]);
  }
  yield* awaited(harness.close(context));
});

const storesCompleteBase = Effect.gen(function* () {
  const { written, live: liveInner, RecordingStorage, setup } = recordingChatSetup();
  const { harness, root } = yield* openChat(new RecordingStorage(), setup);
  const values = new Map<number, LiveState>();
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind !== "msa.live") continue;
      liveInner.liveId = change.record.id;
      if (change.value !== null) values.set(publication.seq, change.value as LiveState);
    }
  });
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const nothingRuns = (value: LiveState) =>
    value.generation === undefined &&
    !(value.tools ?? []).some((slot) => slot.status === "running");
  const kinds = [...written].map(([seq, kind]) => {
    expect(kind === "base").toBe(nothingRuns(values.get(seq)!));
    return kind;
  });
  expect(kinds.filter((kind) => kind === "base").length).toBeGreaterThanOrEqual(5);
  expect(kinds).toContain("delta");
  yield* awaited(harness.close(context));
});

describe("msa.live deltas", () => {
  it("streams partial text as appends", () => Effect.runPromise(streamsPartialText));

  it("stores a complete base exactly in the commits where nothing runs", () =>
    Effect.runPromise(storesCompleteBase));
});

const startsCallsRequest = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    defineTool({
      description: "bad",
      execute: () => Promise.resolve({ details: { fn: (() => 1) as never }, output: [] }),
      name: "bad",
      parameters: Type.Object({}),
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
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const commits: Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.live" && change.ops.length > 0) commits.push([...change.ops]);
    }
  });
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const entries = yield* awaited(root.entries({}, 10, undefined, context));
  const ghostResult = entries.items.find((entry) => entry.kind === "msa.tool-result")!.id;
  const handover = commits.find((ops) => ops.some((op) => op[0] === "s" && op[1][0] === "tools"))!;
  expect(handover).toContainEqual([
    "s",
    ["tools"],
    [
      { callId: "g", entry: ghostResult, name: "ghost", status: "done" },
      { callId: "b", name: "bad", status: "pending", taskId: expect.any(Number) },
    ],
  ]);
  expect(commits).toContainEqual([["s", ["tools", 1, "status"], "done"]]);
  yield* awaited(harness.close(context));
});

describe("msa.live deltas", () => {
  it("starts calls the request did not offer as done and marks a faulted tool's slot done without an entry", () =>
    Effect.runPromise(startsCallsRequest));
});

const commitsToolCalling = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    defineTool({
      description: "noop",
      execute: () => Promise.resolve({ output: [] }),
      name: "noop",
      parameters: Type.Object({}),
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
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
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
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const changes = handover!.changes;
  const kinds = changes.flatMap((change) =>
    change.type === "entry"
      ? [change.value.kind]
      : change.type === "task"
        ? [change.value.kind]
        : [],
  );
  expect(kinds.sort()).toEqual(["msa.assistant", "msa.generation", "msa.tool", "msa.tool"]);
  yield* awaited(harness.close(context));
});

describe("msa.live deltas", () => {
  it("commits the tool-calling answer, its tool tasks, the generation's wait, and the tool round in one commit", () =>
    Effect.runPromise(commitsToolCalling));
});

const writesAbortedTool = Effect.gen(function* () {
  const run = yield* drive();
  yield* awaited(run.step((api) => api.output("partial\n")));
  yield* awaited(run.step((api) => api.details({ n: 1 }, context)));
  const taskId = (yield* awaited(live(run.harness)))!.tools![0]!.taskId!;
  const before = run.commits.length;
  yield* awaited(run.harness.abortTask(taskId, context));
  const isAbortCommit = (ops: readonly Op[]) =>
    ops.some(
      (op) => op[0] === "s" && JSON.stringify(op[1]) === JSON.stringify(["tools", 0, "status"]),
    );
  yield* waitFor(() => run.commits.slice(before).some(isAbortCommit));
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
  yield* awaited(run.harness.close(context));
});

describe("msa.live deltas", () => {
  it("writes an aborted tool's slot with field-level ops", () =>
    Effect.runPromise(writesAbortedTool));

  it("keeps a complete base exactly while nothing runs", () => {
    const base = (value: LiveState) =>
      LiveDoc.definition.checkpointWhen!(value, [], { deltasSinceBase: 1000 } as never);
    const slot = (status: "pending" | "running" | "done") => ({ callId: "c", name: "n", status });
    const run = { inputs: [], taskId: 1 as never };
    expect(base({})).toBe(true);
    expect(base({ generation: { attempt: 1 }, run })).toBe(false);
    expect(base({ run, tools: [slot("pending"), slot("done")] })).toBe(true);
    expect(base({ run, tools: [slot("done"), slot("running")] })).toBe(false);
    expect(base({ run })).toBe(true);
  });
});
