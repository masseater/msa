import { type Conversation, ToolResultEntry } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { describe, expect, it } from "vite-plus/test";

import { type ChatSetup, chatSetup } from "./chat-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import {
  resultText,
  results,
  DONE,
  calls,
  run,
  tool,
  type Execute,
} from "./harness-tools-support.ts";
import { context } from "./session-support.ts";

const trace = async (
  setup: ChatSetup,
  prepare?: (root: Conversation) => Promise<void>,
): Promise<string[]> => {
  const events: string[] = [];
  const slow =
    (name: string): Execute =>
    async () => {
      events.push(`start ${name}`);
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      events.push(`end ${name}`);
      return { output: [] };
    };
  if (setup.registry.snapshot().extension("tool:a") === undefined)
    addTool(setup.registry, tool("a", slow("a")));
  if (setup.registry.snapshot().extension("tool:b") === undefined)
    addTool(setup.registry, tool("b", slow("b")));
  const result = await run(
    setup,
    [calls(["a", {}, "c1"], ["b", {}, "c2"]), DONE],
    (_harness, root) => (prepare === undefined ? Promise.resolve() : prepare(root)),
  );
  await result.harness.close(context);
  return events;
};

describe("tool round", () => {
  it("runs a round in parallel by default and sequentially when configured or required by a tool", async () => {
    expect((await trace(chatSetup())).slice(0, 2)).toEqual(["start a", "start b"]);
    const configured = chatSetup();
    configured.settings.toolExecution = "sequential";
    const sequential = await trace(configured);
    expect(sequential).toEqual(["start a", "end a", "start b", "end b"]);
    const perTool = chatSetup();
    const events: string[] = [];
    addTool(
      perTool.registry,
      tool(
        "a",
        async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 20);
          });
          events.push("a");
          return { output: [] };
        },
        { executionMode: "sequential" },
      ),
    );
    addTool(
      perTool.registry,
      tool("b", () => {
        events.push("b");
        return Promise.resolve({ output: [] });
      }),
    );
    const result = await run(perTool, [calls(["a", {}, "c1"], ["b", {}, "c2"]), DONE]);
    const tasks = await result.harness.commit(
      (tx) => tx.scanTasks({ conversationId: result.root.id }, 20),
      context,
    );
    const tools = tasks.items
      .filter((task) => task.kind === "msa.tool")
      .sort((a, b) => a.id - b.id);
    // The generation owns both tools and creates the second only after the first ended.
    const [generation] = tasks.items.filter((task) => task.kind === "msa.generation");
    expect(tools.map((task) => task.owner)).toEqual([generation!.id, generation!.id]);
    expect(events).toEqual(["a", "b"]);
    await result.harness.close(context);
  });
});

describe("tool results", () => {
  it("uses retained output and the last details when the result omits them, with diagnostics in order", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool(
        "log",
        async (_args, api) => {
          api.output("line 1\n");
          api.output(new TextEncoder().encode("line 2\nline 3\n"));
          api.diagnostic({ severity: "info", message: "from api" });
          await api.details({ step: 1 }, context);
          await api.details({ step: 2 }, context);
          return { diagnostics: [{ severity: "warn", message: "from result" }] };
        },
        { outputLimits: { maxLines: 2 } },
      ),
    );
    const { harness, entries } = await run(setup, [calls(["log", {}, "c1"]), DONE]);
    const [result] = results(entries);
    expect(result!.details).toEqual({ step: 2 });
    expect(resultText(result!)).toBe(
      "line 1\nline 2\n|<harness>\n[info] from api\n[warn] from result\n[warn] Output truncated to its beginning: 1 lines, 7 bytes dropped\n</harness>",
    );
    const entry = entries.find((candidate) => ToolResultEntry.is(candidate));
    expect(
      ToolResultEntry.is(entry) && entry.data.diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual([undefined, undefined, "truncated"]);
    await harness.close(context);
  });
});

describe("tool results", () => {
  it("offers the tail window with the configured pace, not a head window, and accepts skipped output", async () => {
    const setup = { ...chatSetup(), settings: { progress: { outputIntervalMs: 250 } } };
    const windows: unknown[] = [];
    addTool(
      setup.registry,
      tool(
        "tailed",
        (_args, api) => {
          windows.push(api.outputWindow);
          api.output("dropped\n");
          api.output("x\ny\n", { bytes: 8, newlines: 1, endsWithNewline: true });
          return Promise.resolve({});
        },
        { outputLimits: { maxLines: 1, retain: "tail" } },
      ),
    );
    addTool(
      setup.registry,
      tool(
        "headed",
        (_args, api) => {
          windows.push(api.outputWindow);
          return Promise.resolve({});
        },
        { outputLimits: { maxLines: 1 } },
      ),
    );
    const { harness, entries } = await run(setup, [
      calls(["tailed", {}, "c1"], ["headed", {}, "c2"]),
      DONE,
    ]);
    expect(windows).toContainEqual({
      maxBytes: 50 * 1024,
      maxLines: 1,
      minIntervalMs: 250,
      bytesPerSecond: 100 * 1024,
    });
    expect(windows).toContainEqual(undefined);
    // 8 bytes written, 8 skipped, then "x\n" dropped by the window: 3 lines, 18 bytes in all.
    expect(resultText(results(entries).find((result) => result.toolCallId === "c1")!)).toBe(
      "y\n|<harness>\n[warn] Output truncated to its end: 3 lines, 18 bytes dropped\n</harness>",
    );
    await harness.close(context);
  });
});

describe("tool results", () => {
  it("bounds explicit text content and keeps other content", async () => {
    const setup = chatSetup();
    const image = { type: "image", data: "AAAA", mimeType: "image/png" } as const;
    addTool(
      setup.registry,
      tool(
        "big",
        () =>
          Promise.resolve({
            output: [{ type: "text", text: "a\nb\n" }, image, { type: "text", text: "c\nd\n" }],
          }),
        { outputLimits: { maxLines: 2, retain: "tail" } },
      ),
    );
    const { harness, entries } = await run(setup, [calls(["big", {}, "c1"]), DONE]);
    expect(resultText(results(entries)[0]!)).toBe(
      "[image]|c\nd\n|<harness>\n[warn] Output truncated to its end: 2 lines, 4 bytes dropped\n</harness>",
    );
    await harness.close(context);
  });

  it("turns a throw into a tool_error result with the partial output", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("fail", (_args, api) => {
        api.output("partial\n");
        return Promise.reject(new Error("boom"));
      }),
    );
    const { harness, entries, status } = await run(setup, [calls(["fail", {}, "c1"]), DONE]);
    expect(status).toBe("done");
    const [result] = results(entries);
    expect(result!.isError).toBe(true);
    expect(resultText(result!)).toBe("partial\n|<harness>\n[error] boom\n</harness>");
    await harness.close(context);
  });
});

describe("tool results", () => {
  // #10549
  it("records how long execute() took, excluding hooks, and nothing for calls that did not run", async () => {
    const setup = chatSetup();
    const sleep = (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    addTool(
      setup.registry,
      tool("slow", async () => {
        await sleep(30);
        return { output: [] };
      }),
    );
    addTool(
      setup.registry,
      tool("thrower", async () => {
        await sleep(30);
        throw new Error("boom");
      }),
    );
    addHooks(setup.registry, ToolTask, {
      beforeTool: async (call) => {
        await sleep(100);
        return call.id === "blocked" ? { block: "no" } : undefined;
      },
    });
    const { harness, entries } = await run(setup, [
      calls(["slow", {}, "slow"], ["thrower", {}, "thrower"], ["slow", {}, "blocked"]),
      DONE,
    ]);
    const byId = new Map(results(entries).map((result) => [result.toolCallId, result]));
    for (const id of ["slow", "thrower"]) {
      expect(byId.get(id)?.durationMs).toBeGreaterThanOrEqual(25);
      expect(byId.get(id)?.durationMs).toBeLessThan(100);
    }
    expect(byId.get("thrower")?.isError).toBe(true);
    expect(byId.get("blocked")).not.toHaveProperty("durationMs");
    await harness.close(context);
  });
});
