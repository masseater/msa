import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { defineTool } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import { OUTPUT, live, drive } from "./harness-live-deltas-support.ts";
import { addTool } from "./harness-support.ts";
import { context, documentChanges } from "./session-support.ts";

function isOutput(op: Op): boolean {
  return JSON.stringify(op[1]) === JSON.stringify(OUTPUT);
}

async function singleToolChat() {
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
    fauxAssistantMessage([fauxToolCall("noop", {}, { id: "c1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  const commits: Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.live" && change.ops.length > 0) commits.push([...change.ops]);
    }
  });
  return { harness, root, commits };
}

describe("msa.live deltas", () => {
  it("hands a generation over to its tool round and starts a tool with one field write each", async () => {
    const { harness, root, commits } = await singleToolChat();
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const tasks = await harness.commit(
      (tx) => tx.scanTasks({ conversationId: root.id }, 20),
      context,
    );
    const id = (kind: string) =>
      tasks.items.filter((task) => task.kind === kind).map((task) => task.id);
    const [firstGeneration, secondGeneration] = id("msa.generation").sort((a, b) => a - b);
    const [tool] = id("msa.tool");
    const entries = await root.entries({}, 10, undefined, context);
    const result = entries.items.find((entry) => entry.kind === "msa.tool-result")!.id;
    expect(commits).toEqual([
      // submission
      [["s", ["run"], { taskId: firstGeneration, inputs: [expect.any(Number)] }]],
      // request
      [["s", ["generation"], { attempt: 1 }]],
      // the generation starts its tool round and keeps the run
      expect.arrayContaining([
        ["d", ["generation"]],
        ["s", ["tools"], [{ callId: "c1", name: "noop", taskId: tool, status: "pending" }]],
      ]),
      // intent
      [["s", ["tools", 0, "status"], "running"]],
      // result
      expect.arrayContaining([
        ["s", ["tools", 0, "status"], "done"],
        ["s", ["tools", 0, "entry"], result],
      ]),
      // the generation's tools phase hands the run to the next generation
      expect.arrayContaining([
        ["d", ["tools"]],
        ["s", ["run", "taskId"], secondGeneration],
      ]),
      [["s", ["generation"], { attempt: 1 }]],
      // the answer ends the run
      expect.arrayContaining([
        ["d", ["run"]],
        ["d", ["generation"]],
      ]),
    ]);
    expect(commits[2]).toHaveLength(2);
    expect(commits[4]).toHaveLength(2);
    expect(commits[5]).toHaveLength(2);
    await harness.close(context);
  });
});

describe("msa.live deltas", () => {
  it("appends head output and then only updates the dropped counts once the window is full", async () => {
    const run = await drive({ maxLines: 2 });
    expect(await run.step((api) => api.output("one\n"))).toEqual([["s", OUTPUT, "one\n"]]);
    expect(await run.step((api) => api.output("two\n"))).toEqual([["a", OUTPUT, "two\n"]]);
    // The window is full: the retained text stays; only the counts change.
    expect(await run.step((api) => api.output("three\n"))).toEqual([
      ["s", ["tools", 0, "droppedBytes"], 6],
      ["s", ["tools", 0, "droppedLines"], 1],
    ]);
    expect(await run.step((api) => api.output("four\n"))).toEqual([
      ["s", ["tools", 0, "droppedBytes"], 11],
      ["s", ["tools", 0, "droppedLines"], 2],
    ]);
    await run.finish();
    await run.harness.close(context);
  });

  it("slides a tail window as a front trim plus an append", async () => {
    const run = await drive({ maxLines: 3, retain: "tail" });
    expect(await run.step((api) => api.output("line 1\nline 2\nline 3\n"))).toEqual([
      ["s", OUTPUT, "line 1\nline 2\nline 3\n"],
    ]);
    expect(await run.step((api) => api.output("line 4\n"))).toEqual([
      ["t", OUTPUT, 7],
      ["a", OUTPUT, "line 4\n"],
      ["s", ["tools", 0, "droppedBytes"], 7],
      ["s", ["tools", 0, "droppedLines"], 1],
    ]);
    // The buffer keeps only the window, and later slides stay minimal and exact.
    expect(await run.step((api) => api.output("line 5\nline 6\n"))).toEqual([
      ["t", OUTPUT, 14],
      ["a", OUTPUT, "line 5\nline 6\n"],
      ["s", ["tools", 0, "droppedBytes"], 21],
      ["s", ["tools", 0, "droppedLines"], 3],
    ]);
    expect((await live(run.harness))?.tools?.[0]?.output).toBe("line 4\nline 5\nline 6\n");
    await run.finish();
    await run.harness.close(context);
  });
});

describe("msa.live deltas", () => {
  it("writes the whole window when Chord's overlap search cannot find the shared part", async () => {
    // A retained window beyond the 64 KiB overlap scan.
    const wide = await drive({ maxBytes: 100 * 1024, maxLines: 1_000_000, retain: "tail" });
    const line = (index: number) => `${String(index).padStart(10, "0")} ${"x".repeat(989)}\n`;
    let text = "";
    for (let index = 0; index < 100; index++) text += line(index);
    await wide.step((api) => api.output(text));
    const slid = await wide.step((api) =>
      api.output(line(100) + line(101) + line(102) + line(103)),
    );
    expect(slid.filter(isOutput).map((op) => op[0])).toEqual(["s"]);
    await wide.finish();
    await wide.harness.close(context);

    // Repetitive output still finds an overlap here; Chord's bounded candidate search can give up on other inputs
    // and then writes one window.
    const repetitive = await drive({ maxLines: 50, retain: "tail" });
    await repetitive.step((api) => api.output("y\n".repeat(50)));
    const repeated = await repetitive.step((api) => api.output("z\n"));
    expect(repeated.filter(isOutput)).toEqual([
      ["t", OUTPUT, 2],
      ["a", OUTPUT, "z\n"],
    ]);
    await repetitive.finish();
    await repetitive.harness.close(context);
  });
});

describe("msa.live deltas", () => {
  it("diffs details leaf by leaf and appends diagnostics", async () => {
    const run = await drive();
    const details = ["tools", 0, "details"];
    expect(await run.step((api) => api.details({ step: 1, log: "a" }, context))).toEqual([
      ["s", details, { step: 1, log: "a" }],
    ]);
    expect(await run.step((api) => api.details({ step: 2, log: "ab" }, context))).toEqual(
      expect.arrayContaining([
        ["s", [...details, "step"], 2],
        ["a", [...details, "log"], "b"],
      ]),
    );
    expect(await run.step((api) => api.details({ step: 2 }, context))).toEqual([
      ["d", [...details, "log"]],
    ]);
    const diagnostics = ["tools", 0, "diagnostics"];
    const first = { severity: "info", message: "first" } as const;
    const second = { severity: "warn", message: "second" } as const;
    expect(await run.step((api) => api.diagnostic(first))).toEqual([["s", diagnostics, [first]]]);
    expect(await run.step((api) => api.diagnostic(second))).toEqual([
      ["p", diagnostics, 1, 0, [second]],
    ]);
    // Settlement moves everything into the result entry and keeps the slot small.
    const [settled] = await run.finish();
    expect(settled).toEqual(
      expect.arrayContaining([
        ["s", ["tools", 0, "status"], "done"],
        ["d", details],
        ["d", diagnostics],
      ]),
    );
    await run.harness.close(context);
  });
});
