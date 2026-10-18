import { defineTask, LiveDoc } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { resultText, results, DONE, calls, run, tool } from "./harness-tools-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

describe("tool progress and lifetime", () => {
  it("rejects invocation-bound waits and stops watches when the tool's invocation ends", async () => {
    const setup = chatSetup();
    const never = defineTask<Record<string, never>, { phase: "never" }, null>({
      name: "test.never",
      version: 1,
      initial: () => ({ phase: "never" }),
      phases: { never: async () => {} },
      abort: async () => {},
    });
    let wait!: Promise<unknown>;
    let watchClosed!: Promise<unknown>;
    addTool(
      setup.registry,
      tool("detach", async (_args, api) => {
        // The child's definition is not registered, so it stays pending.
        const child = await api.createTask(
          never,
          {},
          { ownership: { kind: "conversation" } },
          context,
        );
        wait = api.waitForTask(child, context);
        wait.catch(() => {});
        const watch = await api.watchDoc(LiveDoc, api.conversationId, context);
        watchClosed = watch!.closed;
        return { output: [] };
      }),
    );
    const { harness } = await run(setup, [calls(["detach", {}, "c1"]), DONE]);
    await expect(wait).rejects.toThrow("invocation has ended");
    await watchClosed;
    await harness.close(context);
  });
});

describe("tool progress and lifetime", () => {
  it("rejects details() still waiting when the call is aborted during afterTool", async () => {
    const setup = chatSetup();
    let pendingDetails!: Promise<void>;
    const inAfterTool = deferred();
    addTool(
      setup.registry,
      tool("slow", (_args, api) => {
        api.output("first\n");
        // The output commit is in flight, so these details wait for the next throttle window.
        pendingDetails = api.details({ step: 1 }, context);
        pendingDetails.catch(() => {});
        return Promise.resolve({});
      }),
    );
    addHooks(setup.registry, ToolTask, {
      afterTool: async (_call, _result, _api, callContext) => {
        inAfterTool.resolve();
        await aborted(callContext.abortSignal!);
        return undefined;
      },
    });
    setup.faux.setResponses([calls(["slow", {}, "c1"]), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await inAfterTool.promise;
    const taskId = (await harness.snapshot(LiveDoc, root.id, context))!.tools![0]!.taskId!;
    await harness.abortTask(taskId, context);
    await expect(pendingDetails).rejects.toBeDefined();
    await submission.wait(context);
    await harness.close(context);
  });
});

describe("tool progress and lifetime", () => {
  it("answers an aborted tool with only its durable output, discarding buffered output", async () => {
    const setup = chatSetup();
    let reached!: () => void;
    const buffered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    addTool(
      setup.registry,
      tool("slow", async (_args, api, callContext) => {
        api.output("durable\n");
        // The first output commits at once; this one waits for the next throttle window.
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        api.output("buffered\n");
        reached();
        await new Promise((_, reject) => {
          callContext.abortSignal!.addEventListener("abort", () =>
            reject(callContext.abortSignal!.reason),
          );
        });
        return {};
      }),
    );
    setup.faux.setResponses([calls(["slow", {}, "c1"]), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await buffered;
    const taskId = (await harness.snapshot(LiveDoc, root.id, context))!.tools![0]!.taskId!;
    await harness.abortTask(taskId, context);
    await submission.wait(context);
    expect(resultText(results(await allEntries(root))[0]!)).toBe(
      "durable\n|<harness>\n[error] Tool slow was aborted\n</harness>",
    );
    await harness.close(context);
  });
});
