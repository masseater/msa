import { rm } from "node:fs/promises";

import { LiveDoc, MemoryStorage, type ToolTaskInput, watchEvents } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import {
  directories,
  results,
  toolTasks,
  runOnce,
  text,
  DONE,
  call,
  tool,
  echoTool,
} from "./harness-nested-tools-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred, eventually } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

function twoWritingNestedCalls() {
  const setup = chatSetup();
  const release = deferred();
  const running = { one: deferred(), two: deferred() };
  const wrote = { one: deferred(), two: deferred() };
  addTool(
    setup.registry,
    tool("slow", async (args, api, callContext) => {
      const name = args.text as "one" | "two";
      running[name].resolve();
      await wrote[name].promise;
      api.output(`${name}\n`);
      await api.details({ name }, callContext);
      await release.promise;
      return {};
    }),
  );
  addTool(
    setup.registry,
    tool("batch", async (_args, api, callContext) => {
      await Promise.all([
        api.executeTool("slow", { text: "one" }, callContext),
        api.executeTool("slow", { text: "two" }, callContext),
      ]);
      return {};
    }),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { setup, release, running, wrote };
}

describe("nested tool calls", () => {
  it("aborts a nested call whose admission was still committing when its caller returned", async () => {
    const setup = chatSetup();
    addTool(setup.registry, echoTool().registration);
    addTool(
      setup.registry,
      tool("hang", (_args, _api, callContext) =>
        Promise.resolve(aborted(callContext.abortSignal!)),
      ),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        await api.executeTool("echo", { text: "warm" }, callContext, { key: "warm" });
        void api.executeTool("hang", {}, callContext, { key: "late" }).catch(() => {});
        return {};
      }),
    );
    const { harness, root, status } = await runOnce(setup, [call("batch"), DONE]);
    expect(status).toBe("done");
    const late = (await toolTasks(harness)).find((task) => {
      const input = task.input as ToolTaskInput;
      return input.kind === "nested" && input.call.name === "hang";
    });
    expect(late!.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("aborts every left-running nested call before waiting for any", async () => {
    const setup = chatSetup();
    const bAborted = deferred();
    const started = { a: deferred(), b: deferred() };
    // A only stops once B was told to stop.
    addTool(
      setup.registry,
      tool("a", async () => {
        started.a.resolve();
        await bAborted.promise;
        return {};
      }),
    );
    addTool(
      setup.registry,
      tool("b", async (_args, _api, callContext) => {
        started.b.resolve();
        await aborted(callContext.abortSignal!).catch(() => {});
        bAborted.resolve();
        throw new Error("aborted");
      }),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        void api.executeTool("a", {}, callContext, { key: "a" }).catch(() => {});
        void api.executeTool("b", {}, callContext, { key: "b" }).catch(() => {});
        await Promise.all([started.a.promise, started.b.promise]);
        return {};
      }),
    );
    const { harness, status } = await runOnce(setup, [call("batch"), DONE]);
    expect(status).toBe("done");
    const nested = (await toolTasks(harness)).filter(
      (task) => (task.input as ToolTaskInput).kind === "nested",
    );
    expect(nested.map((task) => task.state.status)).toEqual(["terminal", "terminal"]);
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("rejects explicit keys that are empty, have a slash, are __proto__, or are positive integers", async () => {
    const setup = chatSetup();
    addTool(setup.registry, echoTool().registration);
    const errors: string[] = [];
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        for await (const key of ["", "a/b", "__proto__", "7"]) {
          await api
            .executeTool("echo", {}, callContext, { key })
            .catch((error: Error) => errors.push(error.message));
        }
        return {};
      }),
    );
    const { harness } = await runOnce(setup, [call("batch"), DONE]);
    const rule = 'must be non-empty, without "/", not "__proto__", and not a positive integer';
    expect(errors).toEqual([
      `Nested call key "" ${rule}`,
      `Nested call key "a/b" ${rule}`,
      `Nested call key "__proto__" ${rule}`,
      `Nested call key "7" ${rule}`,
    ]);
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("runs nested calls of nested calls, and ends them children first", async () => {
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    addTool(
      setup.registry,
      tool("inner", async (_args, api, callContext) => {
        const result = await api.executeTool("echo", { text: "deep" }, callContext, { key: "x" });
        return { output: [{ type: "text", text: text(result) }] };
      }),
    );
    addTool(
      setup.registry,
      tool("outer", async (_args, api, callContext) => {
        const result = await api.executeTool("inner", {}, callContext);
        return { output: [{ type: "text", text: text(result) }] };
      }),
    );
    setup.faux.setResponses([call("outer"), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const stream = await watchEvents(harness, root.id, context);
    const tools: (string | undefined)[][] = [];
    stream.start((batch) => {
      for (const event of batch) {
        if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
          tools.push([event.type, event.toolCallId, event.parentToolCallId]);
        }
      }

      return Promise.resolve();
    });
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    await harness.waitForIdle(context);
    await stream.stop();
    expect(text(results(await allEntries(root))[0])).toBe("echo deep");
    const [outer, inner, deep] = await toolTasks(harness);
    expect([inner!.owner, deep!.owner]).toEqual([outer!.id, inner!.id]);
    expect(tools).toEqual([
      ["tool_execution_start", "c1", undefined],
      ["tool_execution_start", "c1/1", "c1"],
      ["tool_execution_start", "c1/1/x", "c1/1"],
      ["tool_execution_end", "c1/1/x", "c1/1"],
      ["tool_execution_end", "c1/1", "c1"],
      ["tool_execution_end", "c1", undefined],
    ]);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("reports the output of several running nested calls, and shows them to a late subscriber", async () => {
    const { setup, release, running, wrote } = twoWritingNestedCalls();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await Promise.all([running.one.promise, running.two.promise]);
    const stream = await watchEvents(harness, root.id, context);
    expect(stream.snapshot.nestedTools.map((slot) => [slot.callId, slot.status])).toEqual([
      ["c1/1", "running"],
      ["c1/2", "running"],
    ]);
    const updates: [string, unknown][] = [];
    stream.start((batch) => {
      for (const event of batch) {
        if (event.type === "tool_execution_update" && event.output !== undefined) {
          updates.push([event.toolCallId, event.output]);
        }
      }

      return Promise.resolve();
    });
    // The second slot writes first, so a wrong slot index in the update path would show.
    wrote.two.resolve();
    await eventually(() => updates.length === 1);
    wrote.one.resolve();
    await eventually(() => updates.length === 2);
    release.resolve();
    await submission.wait(context);
    await stream.stop();
    expect(updates).toEqual([
      ["c1/2", { set: "two\n" }],
      ["c1/1", { set: "one\n" }],
    ]);
    await harness.close(context);
  });
});
