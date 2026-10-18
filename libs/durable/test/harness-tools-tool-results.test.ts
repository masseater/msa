import { type AssistantMessage } from "@msa/ai";
import { AgentDoc, defineExtension, defineTask, hook, ToolResultEntry } from "@msa/durable";
import { GenerationTask, ToolTask } from "@msa/durable/harness";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup } from "./chat-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { resultText, results, DONE, calls, run, tool } from "./harness-tools-support.ts";
import { context } from "./session-support.ts";

function validatingToolSetup() {
  const setup = chatSetup();
  const seen: { text?: string }[] = [];
  addTool(
    setup.registry,
    tool("echo", (args) => {
      seen.push(args);
      return Promise.resolve({ output: [] });
    }),
  );
  addHooks(setup.registry, ToolTask, {
    beforeTool: (call) => {
      if (call.id === "block") return { block: "not today" };
      if (call.id === "throw") throw new Error("hook failed");
      if (call.id === "bad") return { arguments: { text: { not: "a string" } } };
      return { arguments: { text: `${call.arguments["text"]}!` } };
    },
  });
  return { setup, seen };
}

function selectedHookExtensions() {
  const setup = chatSetup();
  const calledIn: number[] = [];
  const Echo = defineExtension({
    name: "echo",
    tools: [tool("echo", () => Promise.resolve({ output: [] }))],
  });
  const Audit = defineExtension({
    name: "audit",
    hooks: [hook(ToolTask, { beforeTool: (_call, api) => void calledIn.push(api.conversationId) })],
  });
  setup.registry.install(Echo);
  setup.registry.install(Audit);
  return { setup, calledIn, Echo, Audit };
}

describe("tool results", () => {
  it("validates arguments before and after beforeTool and applies blocks and replacements", async () => {
    const { setup, seen } = validatingToolSetup();
    const { harness, entries } = await run(setup, [
      calls(
        ["echo", { text: 1 as unknown as string }, "coerced"],
        ["echo", { text: { not: "a string" } }, "invalid"],
        ["echo", {}, "block"],
        ["echo", {}, "throw"],
        ["echo", { text: "x" }, "bad"],
        ["echo", { text: "x" }, "ok"],
      ),
      DONE,
    ]);
    // Parallel tools append their results in completion order.
    const byId = new Map(
      results(entries).map((result) => [result.toolCallId, [result.isError, resultText(result)]]),
    );
    expect(byId.get("block")).toEqual([
      true,
      "<harness>\n[error] Tool call blocked: not today\n</harness>",
    ]);
    expect(byId.get("throw")).toEqual([
      true,
      "<harness>\n[error] Tool call blocked: hook failed\n</harness>",
    ]);
    expect(byId.get("bad")![0]).toBe(true);
    expect(byId.get("bad")![1]).toContain("Validation failed");
    expect(byId.get("ok")).toEqual([false, ""]);
    expect(byId.get("invalid")![0]).toBe(true);
    expect(byId.get("invalid")![1]).toContain("Validation failed");
    // msa-ai coerces a number to a string before the first validation.
    expect(byId.get("coerced")).toEqual([false, ""]);
    expect(seen).toEqual(expect.arrayContaining([{ text: "1!" }, { text: "x!" }]));
    expect(seen).toHaveLength(2);
    await harness.close(context);
  });
});

describe("tool results", () => {
  it("repairs arguments with prepareArguments before validation, and a throwing repair is invalid", async () => {
    const setup = chatSetup();
    const seen: { text?: string }[] = [];
    addTool(
      setup.registry,
      tool(
        "echo",
        (args) => {
          seen.push(args);
          return Promise.resolve({ output: [] });
        },
        {
          prepareArguments: (args) => {
            const text = (args as { text?: unknown }).text;
            if (text === "throw") throw new Error("cannot repair");
            return typeof text === "number" ? { text: `#${text}` } : (args as { text?: string });
          },
        },
      ),
    );
    const { harness, entries } = await run(setup, [
      calls(
        ["echo", { text: 7 as unknown as string }, "fixed"],
        ["echo", { text: "throw" }, "broken"],
      ),
      DONE,
    ]);
    const byId = new Map(results(entries).map((result) => [result.toolCallId, resultText(result)]));
    expect(byId.get("fixed")).toBe("");
    expect(byId.get("broken")).toBe("<harness>\n[error] cannot repair\n</harness>");
    expect(seen).toEqual([{ text: "#7" }]);
    // The stored call keeps what the model sent.
    const call = (entries[2]!.model![0] as AssistantMessage).content.find(
      (item) => item.type === "toolCall",
    );
    expect(call?.type === "toolCall" && call.arguments).toEqual({ text: 7 });
    await harness.close(context);
  });
});

describe("tool results", () => {
  it("lets the first beforeTool block win and skips later handlers", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("echo", () => Promise.resolve({ output: [] })),
    );
    const asked: string[] = [];
    addHooks(setup.registry, ToolTask, {
      beforeTool: () => {
        asked.push("first");
        return { block: "first says no" };
      },
    });
    addHooks(setup.registry, ToolTask, {
      beforeTool: () => {
        asked.push("second");
        return { block: "second says no" };
      },
    });
    const { harness, entries } = await run(setup, [calls(["echo", {}, "c1"]), DONE]);
    expect(asked).toEqual(["first"]);
    expect(resultText(results(entries)[0]!)).toBe(
      "<harness>\n[error] Tool call blocked: first says no\n</harness>",
    );
    await harness.close(context);
  });
});

describe("tool results", () => {
  it("chains afterTool replacements and observes the round with afterTools", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("echo", () => Promise.resolve({ output: [{ type: "text", text: "raw" }] })),
    );
    addHooks(setup.registry, ToolTask, {
      afterTool: (_call, result) => ({ ...result, output: [{ type: "text", text: "first" }] }),
    });
    addHooks(setup.registry, ToolTask, {
      afterTool: (_call, result) => ({
        ...result,
        details: {
          replaced: (result.output ?? [])
            .map((item) => (item.type === "text" ? item.text : ""))
            .join("|"),
        },
      }),
    });
    const observed: unknown[] = [];
    addHooks(setup.registry, GenerationTask, {
      afterTools: (assistant, entries) => void observed.push(assistant, entries),
    });
    const { harness, entries } = await run(setup, [calls(["echo", {}, "c1"]), DONE]);
    const [result] = results(entries);
    expect(resultText(result!)).toBe("first");
    expect(result!.details).toEqual({ replaced: "first" });
    const resultEntry = entries.find((entry) => ToolResultEntry.is(entry))!;
    expect(observed).toEqual([entries[2]!.id, [resultEntry.id]]);
    await harness.close(context);
  });
});

describe("tool results", () => {
  it("runs the hooks of the selected extensions; a task-owned child copies its owner's selection", async () => {
    const { setup, calledIn, Echo, Audit } = selectedHookExtensions();
    // Audit is installed but not in the default selection.
    setup.settings.extensions = [Echo];
    const first = await run(setup, [DONE]);
    await first.root.configure({ extensions: { add: [Audit] } }, context);
    // An owner task no registered definition takes stays live and pending.
    const owner = defineTask<Record<string, never>, { phase: "never" }, null>({
      name: "test.owner",
      version: 1,
      initial: () => ({ phase: "never" }),
      phases: { never: async () => {} },
      abort: async () => {},
    });
    const childId = await first.harness.commit(async (tx) => {
      const taskId = await tx.createTask(
        owner,
        {},
        { ownership: { kind: "conversation" }, conversationId: first.root.id },
      );
      return (await tx.createConversation({ ownership: { kind: "task", taskId } })).id;
    }, context);
    const child = (await first.harness.conversation(childId, context))!;
    const other = await first.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "faux", modelId: "faux-1" } },
      },
      context,
    );
    for await (const conversation of [first.root, child, other]) {
      setup.faux.setResponses([calls(["echo", {}, "c1"]), DONE]);
      await (await conversation.submit({ type: "input", content: "go" }, context)).wait(context);
    }
    expect(calledIn).toEqual([first.root.id, child.id]);
    await first.harness.close(context);
  });
});

describe("tool results", () => {
  it("applies addTools and terminates only when every result of the round asks to", async () => {
    const setup = chatSetup();
    const stop = tool("stop", () => Promise.resolve({ output: [], control: { terminate: true } }));
    const grow = tool("grow", () =>
      Promise.resolve({
        output: [],
        control: { addTools: ["extra", "stop"] },
      }),
    );
    addTool(setup.registry, stop);
    addTool(setup.registry, grow);
    addTool(
      setup.registry,
      tool("extra", () => Promise.resolve({ output: [] })),
    );
    const first = await run(setup, [calls(["stop", {}, "c1"])], async (_harness, root) => {
      await root.configure({ tools: [stop, grow] }, context);
    });
    expect(first.status).toBe("done");
    expect(first.entries.at(-1)!.kind).toBe("msa.tool-result");
    const settled = await first.harness.commit(
      (tx) => tx.scanTasks({ conversationId: first.root.id }, 20),
      context,
    );
    expect(settled.items.every((task) => task.state.status === "terminal")).toBe(true);

    setup.faux.setResponses([calls(["stop", {}, "c1"], ["grow", {}, "c2"]), DONE]);
    const second = await (
      await first.root.submit({ type: "input", content: "again" }, context)
    ).wait(context);
    expect(second.status).toBe("done");
    expect((await allEntries(first.root)).at(-1)!.kind).toBe("msa.assistant");
    // addTools appends to the stored tool array, skipping names it already holds.
    expect((await first.harness.snapshot(AgentDoc, first.root.id, context))?.tools).toEqual([
      "stop",
      "grow",
      "extra",
    ]);
    await first.harness.close(context);
  });
});
