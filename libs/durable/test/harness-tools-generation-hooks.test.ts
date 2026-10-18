import { type FauxResponseStep, fauxAssistantMessage, fauxText } from "@msa/ai";
import { configure, defineTask, type Harness, LiveDoc, type SubmissionId } from "@msa/durable";
import { GenerationTask, ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { chatSetup, openChat, textOf } from "./chat-support.ts";
import { addHooks, addTask, addTool } from "./harness-support.ts";
import { resultText, results, DONE, calls, run, tool } from "./harness-tools-support.ts";
import { context } from "./session-support.ts";

describe("generation hooks", () => {
  it("replaces request messages, observes responses, and continues on yield", async () => {
    const setup = chatSetup();
    const requests: string[][] = [];
    const record: FauxResponseStep = (request) => {
      requests.push(
        request.messages.map((message) => `${message.role}:${textOf(message as never) ?? ""}`),
      );
      return fauxAssistantMessage([fauxText(`answer ${requests.length}`)]);
    };
    addHooks(setup.registry, GenerationTask, {
      beforeRequest: ({ messages }) => ({
        messages: [...messages, { role: "user", content: "injected", timestamp: 0 }],
      }),
    });
    const responses: string[] = [];
    addHooks(setup.registry, GenerationTask, {
      afterResponse: (message) => void responses.push(textOf(message) ?? ""),
    });
    let yields = 0;
    addHooks(setup.registry, GenerationTask, {
      onYield: () =>
        yields++ === 0 ? { continue: [{ type: "text", text: "keep going" }] } : undefined,
    });
    const { harness, entries, status } = await run(setup, [record, record]);
    expect(status).toBe("done");
    expect(requests[0]!.slice(-2)).toEqual(["user:go", "user:injected"]);
    expect(responses).toEqual(["answer 1", "answer 2"]);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.assistant",
      "msa.user",
      "msa.assistant",
    ]);
    // The injected message was used for the request only.
    expect(entries.some((entry) => textOf(entry.model?.[0]) === "injected")).toBe(false);
    await harness.close(context);
  });
});

describe("generation hooks", () => {
  it("keeps the run's input open across an onYield continuation and answers it with the final answer", async () => {
    const setup = chatSetup();
    let yields = 0;
    let harness!: Harness;
    let input: SubmissionId | undefined;
    let statusAtSecondRequest: string | undefined;
    addHooks(setup.registry, GenerationTask, {
      onYield: () => (yields++ === 0 ? { continue: "again" } : undefined),
    });
    const second: FauxResponseStep = async () => {
      input = (await harness.snapshot(LiveDoc, 1 as never, context))!.run!.inputs[0];
      statusAtSecondRequest = (await (await harness.submission(input!, context))!.status(context))
        .status;
      return fauxAssistantMessage([fauxText("second")]);
    };
    const result = await run(
      setup,
      [fauxAssistantMessage([fauxText("first")]), second],
      (opened) => {
        harness = opened;

        return Promise.resolve();
      },
    );
    expect(statusAtSecondRequest).toBe("placed");
    const answers = result.entries.filter((entry) => entry.kind === "msa.assistant");
    expect(await (await harness.submission(input!, context))!.status(context)).toMatchObject({
      status: "done",
      answer: answers[1]!.id,
    });
    await harness.close(context);
  });

  it("observes responses that arrive by polling a deferred request", async () => {
    const setup = chatSetup({ deferred: { pendingFetches: 1, pollAfterMs: 1 } });
    const observed: string[] = [];
    addHooks(setup.registry, GenerationTask, {
      afterResponse: (message) =>
        void observed.push(`${message.stopReason}:${textOf(message) ?? ""}`),
    });
    setup.settings.stream = { deferred: true };
    const result = await run(setup, [fauxAssistantMessage([fauxText("late")])]);
    expect(result.status).toBe("done");
    // The still-deferred results are not terminal.
    expect(observed).toEqual(["stop:late"]);
    await result.harness.close(context);
  });
});

describe("generation hooks", () => {
  it("lets the first onYield continuation win and reports throws without stopping later handlers", async () => {
    const setup = chatSetup();
    const called: string[] = [];
    addHooks(setup.registry, GenerationTask, {
      afterResponse: () => {
        called.push("throwing observer");
        throw new Error("observer failed");
      },
    });
    addHooks(setup.registry, GenerationTask, {
      afterResponse: () => void called.push("next observer"),
    });
    let yields = 0;
    addHooks(setup.registry, GenerationTask, {
      onYield: () => (yields++ === 0 ? { continue: "first" } : undefined),
    });
    addHooks(setup.registry, GenerationTask, {
      onYield: () => {
        called.push("second onYield");
        return called.filter((name) => name === "second onYield").length === 1
          ? { continue: "second" }
          : undefined;
      },
    });
    const { harness, entries } = await run(setup, [
      fauxAssistantMessage([fauxText("a")]),
      fauxAssistantMessage([fauxText("b")]),
      fauxAssistantMessage([fauxText("c")]),
    ]);
    // The first continuation skips the second handler; on the next answer the second handler's continuation wins.
    const users = entries
      .filter((entry) => entry.kind === "msa.user")
      .map((entry) => textOf(entry.model![0]));
    expect(users).toEqual(["go", "first", "second"]);
    expect(called.filter((name) => name === "second onYield")).toHaveLength(2);
    expect(called.filter((name) => name === "next observer")).toHaveLength(3);
    expect(setup.reports.map((error) => (error as Error).message)).toContain("observer failed");
    await harness.close(context);
  });
});

describe("generation hooks", () => {
  it("keeps durable hook decisions in task memos", async () => {
    const setup = chatSetup();
    let asked = 0;
    addTool(
      setup.registry,
      tool("echo", () => Promise.resolve({ output: [] })),
    );
    addHooks(setup.registry, ToolTask, {
      beforeTool: async (_call, api) => {
        asked++;
        const decision = await api.memo("approval:decision", "approved", context);
        expect(await api.memo("approval:decision", "denied", context)).toBe(decision);
        return undefined;
      },
    });
    const { harness } = await run(setup, [calls(["echo", {}, "c1"]), DONE]);
    expect(asked).toBe(1);
    await harness.close(context);
  });
});

function probingToolSetup() {
  const setup = chatSetup();
  const child = defineTask<{ n: number }, { phase: "run" }, number>({
    name: "test.child",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (task, runtime, callContext) => {
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result: task.input.n * 2 },
          }),
          callContext,
        );
      },
    },
    abort: async () => {},
  });
  addTask(setup.registry, child);
  const seen: unknown[] = [];
  const probe = tool("probe", async (_args, api) => {
    seen.push(api.env?.cwd);
    seen.push((await api.agent(context)).tools.map((each) => each.name));
    seen.push(api.registry.extension("tool:probe") !== undefined);
    const entry = await api.commit(async (tx) => {
      // The next call runs in the new directory: its environment is built when it executes.
      await configure(tx, api.conversationId, { cwd: "/" });
      return tx.appendEntry(api.conversationId, { kind: "test.note", data: api.callId });
    }, context);
    seen.push(entry.byTaskId === api.taskId);
    seen.push(await api.memo("m", 1, context), await api.memo("m", 2, context));
    const id = await api.createTask(
      child,
      { n: 21 },
      { ownership: { kind: "conversation" } },
      context,
    );
    const done = await api.waitForTask(id, context);
    seen.push(done.state.outcome);
    return { output: [] };
  });
  addTool(setup.registry, probe);
  return { setup, seen };
}

describe("tool execution api", () => {
  it("builds the environment per call from the conversation's cwd and runs commits, memos, and child tasks", async () => {
    const { setup, seen } = probingToolSetup();
    setup.faux.setResponses([calls(["probe", {}, "c1"], ["probe", {}, "c2"]), DONE]);
    setup.settings.toolExecution = "sequential";
    const targets: unknown[] = [];
    const { harness, root } = await openChat(new MemoryStorage(), setup, {
      env: ({ conversationId, cwd }) => {
        targets.push([conversationId, cwd]);
        return new NodeExecutionEnv({ cwd: cwd ?? "/tmp" });
      },
    });
    await root.configure({ cwd: "/tmp" }, context);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const outcome = { status: "completed", result: 42 };
    const call = (cwd: string) => [cwd, ["probe"], true, true, 1, 1, outcome];
    expect(seen).toEqual([...call("/tmp"), ...call("/")]);
    expect(targets).toContainEqual([root.id, "/tmp"]);
    expect(targets).toContainEqual([root.id, "/"]);
    await harness.close(context);
  });

  it("answers a throwing environment with a tool_error result and reports it once while preparing", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("probe", () => Promise.resolve({ output: [{ type: "text", text: "ran" }] })),
    );
    const { harness, entries } = await run(setup, [calls(["probe", {}, "c1"]), DONE], undefined, {
      env: () => {
        throw new Error("no sandbox");
      },
    });
    const [result] = results(entries);
    expect(result).toMatchObject({ isError: true });
    expect(resultText(result!)).toBe("<harness>\n[error] no sandbox\n</harness>");
    // Each preparation reports the failure and renders without an environment.
    expect(setup.reports.filter((error) => (error as Error).message === "no sandbox").length).toBe(
      2,
    );
    await harness.close(context);
  });
});
