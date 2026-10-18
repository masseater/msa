import { type FauxResponseStep, type SystemMessage } from "@msa/ai";
import { type Conversation, LiveDoc, ToolResultEntry } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup } from "./chat-support.ts";
import { addHooks, addTool, type Installed } from "./harness-support.ts";
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

describe("tool round", () => {
  it("runs input, tool call, tool result, and answer, and settles the input", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("echo", (args) =>
        Promise.resolve({
          output: [{ type: "text", text: `echo ${args.text}` }],
        }),
      ),
    );
    const { harness, root, entries, status } = await run(setup, [
      calls(["echo", { text: "hi" }, "c1"]),
      DONE,
    ]);
    expect(status).toBe("done");
    expect(entries.map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.system",
      "msa.assistant",
      "msa.tool-result",
      "msa.assistant",
    ]);
    const system = entries[1]!.model![0] as SystemMessage;
    expect(system.toolsAdded).toEqual([
      { name: "echo", description: "The echo tool", parameters: expect.any(Object) },
    ]);
    const [result] = results(entries);
    expect(result).toMatchObject({ toolCallId: "c1", toolName: "echo", isError: false });
    expect(resultText(result!)).toBe("echo hi");
    expect(ToolResultEntry.is(entries[3]) && entries[3].data).toEqual({ diagnostics: [] });
    expect(entries[3]!.byTaskId).toBeDefined();
    // The second request sees the tool result right after its call.
    expect(setup.faux.state.callCount).toBe(2);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });
});

describe("tool round", () => {
  // #10395
  it("gives tools and hooks the Harness's models", async () => {
    const setup = chatSetup();
    const seen: unknown[] = [];
    addTool(
      setup.registry,
      tool("echo", (_args, api) => {
        seen.push(api.models);
        return Promise.resolve({ output: [] });
      }),
    );
    addHooks(setup.registry, ToolTask, {
      beforeTool: (_call, api) => {
        seen.push(api.models);
        return undefined;
      },
    });
    const { harness, status } = await run(setup, [calls(["echo", {}, "c1"]), DONE]);
    expect(status).toBe("done");
    expect(seen).toEqual([setup.models, setup.models]);
    expect(seen.every((models) => models === setup.models)).toBe(true);
    await harness.close(context);
  });
});

describe("tool round", () => {
  it("answers calls to tools the request did not offer without a task", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("echo", () => Promise.resolve({ output: [] })),
    );
    const { harness, root, entries, status } = await run(setup, [
      calls(["ghost", {}, "c1"], ["echo", {}, "c2"]),
      DONE,
    ]);
    expect(status).toBe("done");
    const [ghost, echo] = results(entries);
    expect(ghost).toMatchObject({ toolCallId: "c1", isError: true });
    expect(resultText(ghost!)).toBe("<harness>\n[error] Tool ghost is not available\n</harness>");
    expect(echo).toMatchObject({ toolCallId: "c2", isError: false });
    const ghostEntry = entries.find(
      (entry) => ToolResultEntry.is(entry) && entry.model![0]!.role === "toolResult",
    );
    expect(ghostEntry?.data).toEqual({
      diagnostics: [
        { severity: "error", code: "tool_unavailable", message: "Tool ghost is not available" },
      ],
    });
    const tasks = await harness.commit(
      (tx) => tx.scanTasks({ conversationId: root.id }, 20),
      context,
    );
    expect(tasks.items.filter((task) => task.kind === "msa.tool")).toHaveLength(1);
    await harness.close(context);
  });
});

describe("tool round", () => {
  it("answers a call to a tool deactivated after preparation with tool_unavailable", async () => {
    const setup = chatSetup();
    const seen: string[] = [];
    addTool(
      setup.registry,
      tool("echo", () => {
        seen.push("ran");
        return Promise.resolve({ output: [] });
      }),
    );
    let root!: Conversation;
    const deactivate: FauxResponseStep = async () => {
      await root.configure({ tools: [] }, context);
      return calls(["echo", {}, "c1"]);
    };
    const result = await run(setup, [deactivate, DONE], (_harness, conversation) => {
      root = conversation;

      return Promise.resolve();
    });
    expect(seen).toEqual([]);
    expect(resultText(results(result.entries)[0]!)).toBe(
      "<harness>\n[error] Tool echo is not available\n</harness>",
    );
    // The next preparation removes it.
    const systems = result.entries.filter((entry) => entry.kind === "msa.system");
    expect((systems.at(-1)!.model![0] as SystemMessage).toolsRemoved).toEqual([{ name: "echo" }]);
    await result.harness.close(context);
  });
});

describe("tool round", () => {
  it("removes unregistered active tools from the offer and adds them back after re-registration", async () => {
    const setup = chatSetup();
    const echo = tool("echo", () => Promise.resolve({ output: [] }));
    const registration = addTool(setup.registry, echo);
    const first = await run(setup, [DONE]);
    registration.dispose();
    setup.faux.setResponses([calls(["echo", {}, "c1"]), DONE]);
    const second = await (
      await first.root.submit({ type: "input", content: "again" }, context)
    ).wait(context);
    expect(second.status).toBe("done");
    let entries = await allEntries(first.root);
    const removal = entries.filter((entry) => entry.kind === "msa.system").at(-1)!
      .model![0] as SystemMessage;
    expect(removal.toolsRemoved).toEqual([{ name: "echo" }]);
    expect(results(entries)[0]).toMatchObject({ isError: true });
    // The stored agent is not rewritten; the tool is only not resolved.
    expect((await first.root.agent(context)).tools).toEqual([]);

    addTool(setup.registry, echo);
    setup.faux.setResponses([DONE]);
    await (await first.root.submit({ type: "input", content: "back" }, context)).wait(context);
    entries = await allEntries(first.root);
    const addition = entries.filter((entry) => entry.kind === "msa.system").at(-1)!
      .model![0] as SystemMessage;
    expect(addition.toolsAdded?.map((declared) => declared.name)).toEqual(["echo"]);
    await first.harness.close(context);
  });
});

describe("tool round", () => {
  it("produces tool_unavailable when the implementation is unregistered before its task runs", async () => {
    const setup = chatSetup();
    let second!: Installed;
    addTool(
      setup.registry,
      tool(
        "first",
        () => {
          second.dispose();
          return Promise.resolve({ output: [] });
        },
        { executionMode: "sequential" },
      ),
    );
    second = addTool(
      setup.registry,
      tool("second", () => Promise.resolve({ output: [{ type: "text", text: "ran" }] })),
    );
    const { harness, entries, status } = await run(setup, [
      calls(["first", {}, "c1"], ["second", {}, "c2"]),
      DONE,
    ]);
    expect(status).toBe("done");
    const [, late] = results(entries);
    expect(resultText(late!)).toBe("<harness>\n[error] Tool second is not available\n</harness>");
    await harness.close(context);
  });
});

describe("tool round", () => {
  it("reads the execution mode when a round starts and keeps it for the round", async () => {
    const setup = chatSetup();
    const events: string[] = [];
    const slow =
      (name: string): Execute =>
      async () => {
        events.push(`start ${name}`);
        // Changed after the round started: not seen by this round.
        setup.settings.toolExecution = "parallel";
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        events.push(`end ${name}`);
        return { output: [] };
      };
    addTool(setup.registry, tool("a", slow("a")));
    addTool(setup.registry, tool("b", slow("b")));
    // Changed while the model request runs: the round that follows uses it.
    const request: FauxResponseStep = () => {
      setup.settings.toolExecution = "sequential";
      return calls(["a", {}, "c1"], ["b", {}, "c2"]);
    };
    const { harness } = await run(setup, [request, DONE]);
    expect(events).toEqual(["start a", "end a", "start b", "end b"]);
    await harness.close(context);
  });
});
