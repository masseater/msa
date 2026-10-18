import { rm } from "node:fs/promises";

import { fauxAssistantMessage, fauxText, Type } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import { defineTool, LiveDoc } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat, waitFor } from "./chat-support.ts";
import {
  state,
  outcomeOf,
  open,
  gate,
  gates,
  Node,
  behaviors,
  log,
  OWN_CONVERSATION,
  owned,
  script,
  directories,
  toolCalls,
  labels,
  listen,
} from "./harness-structured-support.ts";
import { addTask, addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { settled } from "./task-support.ts";

afterEach(async () => {
  behaviors.clear();
  gates.clear();
  log.length = 0;
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("tool rounds and events", () => {
  it("lets a tool that owns live work finish its call at the hold while the generation waits for its final commit", async () => {
    const setup = chatSetup();
    addTask(setup.registry, Node);
    addTool(
      setup.registry,
      defineTool({
        name: "delegate",
        description: "Starts work in a conversation it owns",
        parameters: Type.Object({}),
        execute: async (_args, api, callContext) => {
          await api.commit(async (tx) => {
            const child = await tx.createConversation({
              ownership: { kind: "task", taskId: api.taskId },
            });
            await tx.createTask(
              Node,
              { name: "sub" },
              { ...OWN_CONVERSATION, conversationId: child.id },
            );
          }, callContext);
          return { output: [{ type: "text", text: "started" }] };
        },
      }),
    );
    setup.faux.setResponses([
      toolCalls(["delegate", "c1"]),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const { stream, events } = await listen(harness, root);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await waitFor(
      async () =>
        (await harness.snapshot(LiveDoc, root.id, context))?.tools?.[0]?.status === "done",
    );
    const live = (await harness.snapshot(LiveDoc, root.id, context))!;
    const tool = live.tools![0]!.taskId!;
    expect(live.tools![0]!.entry).toBeDefined();
    expect((await state(harness, tool)).status).toBe("completing");
    expect((await state(harness, live.run!.taskId)).status).toBe("waiting");
    await waitFor(() => labels(events).includes("end:c1:true"));
    expect(await settled(submission.wait(context))).toBe(false);
    open("sub");
    expect((await submission.wait(context)).status).toBe("done");
    expect(await outcomeOf(harness, tool)).toBe("completed");
    await stream.stop();
    await harness.close(context);
  });
});

describe("tool rounds and events", () => {
  it("holds a faulted tool's slot and task_failed until the work it owns drained", async () => {
    const setup = chatSetup();
    addTask(setup.registry, Node);
    script("held", {
      abort: async (runtime, ctx) => {
        await gate("abort.held").promise;
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
      },
    });
    addTool(
      setup.registry,
      defineTool({
        name: "broken",
        description: "Starts owned work, then returns a result that is not strict JSON",
        parameters: Type.Object({}),
        execute: async (_args, api, callContext) => {
          await api.commit(
            (tx) => tx.createTask(Node, { name: "held" }, owned(api.taskId)),
            callContext,
          );
          return { output: [], details: { fn: (() => 1) as unknown as JsonValue } };
        },
      }),
    );
    setup.faux.setResponses([
      toolCalls(["broken", "c1"]),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const { stream, events } = await listen(harness, root);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await waitFor(() => log.includes("abort:held"));
    const live = (await harness.snapshot(LiveDoc, root.id, context))!;
    const tool = live.tools![0]!.taskId!;
    expect(await state(harness, tool)).toMatchObject({
      status: "completing",
      outcome: { status: "faulted" },
    });
    expect(live.tools![0]!.status).not.toBe("done");
    expect(events.some((event) => event.type === "task_failed")).toBe(false);
    open("abort.held");
    expect((await submission.wait(context)).status).toBe("done");
    expect(await outcomeOf(harness, tool)).toBe("faulted");
    await waitFor(() => events.some((event) => event.type === "task_failed"));
    expect(labels(events)).toContain("end:c1:false");
    await stream.stop();
    await harness.close(context);
  });
});
