import { Type, fauxAssistantMessage, fauxText, fauxToolCall } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { defineTool } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessLiveDeltasSupport from "./harness-live-deltas-support.ts";
import support from "./support.ts";

const { OUTPUT, drive, live } = harnessLiveDeltasSupport;
const { addTool, awaited, chatSetup, context, documentChanges, openChat } = support;

function isOutput(op: Op): boolean {
  return JSON.stringify(op[1]) === JSON.stringify(OUTPUT);
}

const singleToolChat = Effect.fn("singleToolChat")(function* () {
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
    fauxAssistantMessage([fauxToolCall("noop", {}, { id: "c1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const commits: Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.live" && change.ops.length > 0) commits.push([...change.ops]);
    }
  });
  return { commits, harness, root };
});

const handsGenerationOver = Effect.gen(function* () {
  const { harness, root, commits } = yield* singleToolChat();
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const tasks = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 20), context),
  );
  const id = (kind: string) =>
    tasks.items.filter((task) => task.kind === kind).map((task) => task.id);
  const [firstGeneration, secondGeneration] = id("msa.generation").sort((a, b) => a - b);
  const [tool] = id("msa.tool");
  const entries = yield* awaited(root.entries({}, 10, undefined, context));
  const result = entries.items.find((entry) => entry.kind === "msa.tool-result")!.id;
  expect(commits).toEqual([
    [["s", ["run"], { inputs: [expect.any(Number)], taskId: firstGeneration }]],
    [["s", ["generation"], { attempt: 1 }]],
    expect.arrayContaining([
      ["d", ["generation"]],
      ["s", ["tools"], [{ callId: "c1", name: "noop", status: "pending", taskId: tool }]],
    ]),
    [["s", ["tools", 0, "status"], "running"]],
    expect.arrayContaining([
      ["s", ["tools", 0, "status"], "done"],
      ["s", ["tools", 0, "entry"], result],
    ]),
    expect.arrayContaining([
      ["d", ["tools"]],
      ["s", ["run", "taskId"], secondGeneration],
    ]),
    [["s", ["generation"], { attempt: 1 }]],
    expect.arrayContaining([
      ["d", ["run"]],
      ["d", ["generation"]],
    ]),
  ]);
  expect(commits[2]).toHaveLength(2);
  expect(commits[4]).toHaveLength(2);
  expect(commits[5]).toHaveLength(2);
  yield* awaited(harness.close(context));
});

describe("msa.live deltas", () => {
  it("hands a generation over to its tool round and starts a tool with one field write each", () =>
    Effect.runPromise(handsGenerationOver));
});

const appendsHeadOutput = Effect.gen(function* () {
  const run = yield* drive({ maxLines: 2 });
  expect(yield* awaited(run.step((api) => api.output("one\n")))).toEqual([["s", OUTPUT, "one\n"]]);
  expect(yield* awaited(run.step((api) => api.output("two\n")))).toEqual([["a", OUTPUT, "two\n"]]);
  expect(yield* awaited(run.step((api) => api.output("three\n")))).toEqual([
    ["s", ["tools", 0, "droppedBytes"], 6],
    ["s", ["tools", 0, "droppedLines"], 1],
  ]);
  expect(yield* awaited(run.step((api) => api.output("four\n")))).toEqual([
    ["s", ["tools", 0, "droppedBytes"], 11],
    ["s", ["tools", 0, "droppedLines"], 2],
  ]);
  yield* awaited(run.finish());
  yield* awaited(run.harness.close(context));
});

const slidesTailWindow = Effect.gen(function* () {
  const run = yield* drive({ maxLines: 3, retain: "tail" });
  expect(yield* awaited(run.step((api) => api.output("line 1\nline 2\nline 3\n")))).toEqual([
    ["s", OUTPUT, "line 1\nline 2\nline 3\n"],
  ]);
  expect(yield* awaited(run.step((api) => api.output("line 4\n")))).toEqual([
    ["t", OUTPUT, 7],
    ["a", OUTPUT, "line 4\n"],
    ["s", ["tools", 0, "droppedBytes"], 7],
    ["s", ["tools", 0, "droppedLines"], 1],
  ]);
  expect(yield* awaited(run.step((api) => api.output("line 5\nline 6\n")))).toEqual([
    ["t", OUTPUT, 14],
    ["a", OUTPUT, "line 5\nline 6\n"],
    ["s", ["tools", 0, "droppedBytes"], 21],
    ["s", ["tools", 0, "droppedLines"], 3],
  ]);
  expect((yield* awaited(live(run.harness)))?.tools?.[0]?.output).toBe("line 4\nline 5\nline 6\n");
  yield* awaited(run.finish());
  yield* awaited(run.harness.close(context));
});

describe("msa.live deltas", () => {
  it("appends head output and then only updates the dropped counts once the window is full", () =>
    Effect.runPromise(appendsHeadOutput));

  it("slides a tail window as a front trim plus an append", () =>
    Effect.runPromise(slidesTailWindow));
});

const writesWholeWindow = Effect.gen(function* () {
  const wide = yield* drive({ maxBytes: 100 * 1024, maxLines: 1_000_000, retain: "tail" });
  const line = (index: number) => `${String(index).padStart(10, "0")} ${"x".repeat(989)}\n`;
  let text = "";
  for (let index = 0; index < 100; index++) text += line(index);
  yield* awaited(wide.step((api) => api.output(text)));
  const slid = yield* awaited(
    wide.step((api) => api.output(line(100) + line(101) + line(102) + line(103))),
  );
  expect(slid.filter(isOutput).map((op) => op[0])).toEqual(["s"]);
  yield* awaited(wide.finish());
  yield* awaited(wide.harness.close(context));

  const repetitive = yield* drive({ maxLines: 50, retain: "tail" });
  yield* awaited(repetitive.step((api) => api.output("y\n".repeat(50))));
  const repeated = yield* awaited(repetitive.step((api) => api.output("z\n")));
  expect(repeated.filter(isOutput)).toEqual([
    ["t", OUTPUT, 2],
    ["a", OUTPUT, "z\n"],
  ]);
  yield* awaited(repetitive.finish());
  yield* awaited(repetitive.harness.close(context));
});

describe("msa.live deltas", () => {
  it("writes the whole window when Chord's overlap search cannot find the shared part", () =>
    Effect.runPromise(writesWholeWindow));
});

const diffsDetailsLeaf = Effect.gen(function* () {
  const run = yield* drive();
  const details = ["tools", 0, "details"];
  expect(yield* awaited(run.step((api) => api.details({ log: "a", step: 1 }, context)))).toEqual([
    ["s", details, { log: "a", step: 1 }],
  ]);
  expect(yield* awaited(run.step((api) => api.details({ log: "ab", step: 2 }, context)))).toEqual(
    expect.arrayContaining([
      ["s", [...details, "step"], 2],
      ["a", [...details, "log"], "b"],
    ]),
  );
  expect(yield* awaited(run.step((api) => api.details({ step: 2 }, context)))).toEqual([
    ["d", [...details, "log"]],
  ]);
  const diagnostics = ["tools", 0, "diagnostics"];
  const first = { message: "first", severity: "info" } as const;
  const second = { message: "second", severity: "warn" } as const;
  expect(yield* awaited(run.step((api) => api.diagnostic(first)))).toEqual([
    ["s", diagnostics, [first]],
  ]);
  expect(yield* awaited(run.step((api) => api.diagnostic(second)))).toEqual([
    ["p", diagnostics, 1, 0, [second]],
  ]);
  const [settled] = yield* awaited(run.finish());
  expect(settled).toEqual(
    expect.arrayContaining([
      ["s", ["tools", 0, "status"], "done"],
      ["d", details],
      ["d", diagnostics],
    ]),
  );
  yield* awaited(run.harness.close(context));
});

describe("msa.live deltas", () => {
  it("diffs details leaf by leaf and appends diagnostics", () =>
    Effect.runPromise(diffsDetailsLeaf));
});
