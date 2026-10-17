import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import type { Draft } from "@msa/chord";
import {
  AgentDoc,
  type AgentEvent,
  type AgentEventStream,
  defineTool,
  LiveDoc,
  type LiveState,
  MemoryStorage,
  type SnapshotEvent,
  UsageDoc,
  watchEvents,
} from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat, waitFor } from "./chat-support.ts";
import { listen, drained, applyChanges } from "./harness-events-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

async function liveChangeSequence() {
  const { harness, root } = await openChat(new MemoryStorage(), chatSetup());
  const { stream, batches } = await listen(harness, root);
  const change = (edit: (live: Draft<LiveState>) => void) =>
    root.commit(async (tx) => edit(await tx.doc(LiveDoc, root.id)), context);
  const partial = JSON.parse(JSON.stringify(fauxAssistantMessage([fauxText("partial")])));
  await change((live) => {
    live.generation = { attempt: 1, message: partial };
  });
  // A usage-only change sends the usage and no changes.
  await change((live) => {
    live.generation!.message!.usage.input = 42;
  });
  await change((live) => {
    live.generation = { attempt: 1, deferred: { pollAt: 1 } };
  });
  await change((live) => {
    live.generation!.deferred!.pollAt = 2;
  });
  await change((live) => {
    live.tools = [
      { callId: "c1", name: "t", status: "running", details: { n: 1 }, diagnostics: [] },
    ];
  });
  // A safe replay clears the running slot's progress.
  await change((live) => {
    delete live.tools![0]!.details;
    delete live.tools![0]!.diagnostics;
  });
  // A fault marks the slot done without an entry.
  await change((live) => {
    live.tools![0]!.status = "done";
  });
  return { harness, root, stream, batches, partial };
}

describe("agent events", () => {
  it("reports a steer without run events, a reset as an appended entry, and nothing for other conversations", async () => {
    const setup = chatSetup();
    const gate = deferred();
    addTool(
      setup.registry,
      defineTool({
        name: "hold",
        description: "Waits",
        parameters: Type.Object({}),
        execute: async () => {
          await gate.promise;
          return {};
        },
      }),
    );
    setup.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("hold", {}, { id: "c1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const other = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    const { stream, events, batches } = await listen(harness, root);
    const input = await root.submit({ type: "input", content: "a" }, context);
    await waitFor(() => events().some((event) => event.type === "tool_execution_start"));
    await root.submit({ type: "input", content: "s", whenBusy: "steer" }, context);
    const before = batches.length;
    await other.commit((tx) => tx.appendEntry(other.id, { kind: "note" }), context);
    await drained();
    expect(batches.length).toBe(before);
    gate.resolve();
    await input.wait(context);
    await root.reset(undefined, context);
    await drained();
    expect(events().filter((event) => event.type === "run_start")).toHaveLength(1);
    expect(events().filter((event) => event.type === "run_end")).toHaveLength(1);
    expect(batches.at(-1)!.map((event) => event.type)).toEqual(["entry_appended", "submission"]);
    await stream.stop();
    await harness.close(context);
  });
});

describe("agent events", () => {
  it("rejects an attachment cancelled while it waits for the Session line", async () => {
    const { harness, root } = await openChat(new MemoryStorage(), chatSetup());
    const release = deferred();
    const blocking = root.commit(async () => {
      await release.promise;
    }, context);
    const controller = new AbortController();
    const attaching = watchEvents(harness, root.id, { ...context, abortSignal: controller.signal });
    controller.abort(new Error("cancelled"));
    release.resolve();
    await blocking;
    await expect(attaching).rejects.toThrow("cancelled");
    await harness.close(context);
  });
});

describe("agent events", () => {
  it("applies deltas after an overflow snapshot that holds an in-flight partial", async () => {
    const { harness, root } = await openChat(new MemoryStorage(), chatSetup());
    const partial = fauxAssistantMessage([fauxText("hel")]);
    const stream = await watchEvents(harness, root.id, context);
    await root.commit(async (tx) => {
      (await tx.doc(LiveDoc, root.id)).generation = {
        attempt: 1,
        message: JSON.parse(JSON.stringify(partial)),
      };
    }, context);
    for await (const _ of Array.from({ length: 101 })) {
      await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    }
    const batches: AgentEvent[][] = [];
    stream.start((events) => {
      batches.push([...events]);

      return Promise.resolve();
    });
    await drained();
    const snapshot = batches[0]![0] as SnapshotEvent;
    expect(snapshot.type).toBe("snapshot");
    await root.commit(async (tx) => {
      const block = (await tx.doc(LiveDoc, root.id)).generation!.message!.content[0] as {
        text: string;
      };
      block.text += "lo";
    }, context);
    await drained();
    const update = batches.at(-1)![0]!;
    if (update.type !== "message_update") throw new Error(`Unexpected ${update.type}`);
    expect(update.changes).toEqual([{ type: "text_delta", contentIndex: 0, delta: "lo" }]);
    const rebuilt = applyChanges(snapshot.generation!.message!, update.changes);
    expect(rebuilt.content).toEqual([{ type: "text", text: "hello" }]);
    await stream.stop();
    await harness.close(context);
  });
});

describe("agent events", () => {
  it("reports usage-only updates, cleared tool progress, tools ending without entries, and deferred polls", async () => {
    const { harness, root, stream, batches, partial } = await liveChangeSequence();
    await root.commit((tx) => tx.retireDoc(UsageDoc, root.id), context);
    await root.commit((tx) => tx.retireDoc(AgentDoc, root.id), context);
    await drained();
    expect(batches.map((batch) => batch.filter((event) => event.type !== "task_failed"))).toEqual([
      [{ type: "message_start", message: partial }],
      [{ type: "message_update", usage: { ...partial.usage, input: 42 }, changes: [] }],
      [{ type: "deferred_poll", pollAt: 1 }],
      [{ type: "deferred_poll", pollAt: 2 }],
      [{ type: "tool_execution_start", toolCallId: "c1", toolName: "t", args: {} }],
      [
        {
          type: "tool_execution_update",
          toolCallId: "c1",
          toolName: "t",
          details: null,
          diagnostics: [],
        },
      ],
      [{ type: "tool_execution_end", toolCallId: "c1", toolName: "t" }],
      // Retired documents read as their initial values.
      [{ type: "usage_changed", usage: { models: {}, tools: {} } }],
      [{ type: "agent_changed", agent: {} }],
    ]);
    await stream.stop();
    await harness.close(context);
  });

  it("ends the stream with the Harness", async () => {
    const { harness, root } = await openChat(new MemoryStorage(), chatSetup());
    const stream: AgentEventStream = await watchEvents(harness, root.id, context);
    await harness.close(context);
    expect(await stream.closed).toEqual({ reason: "session_closed" });
  });
});

describe("agent events", () => {
  it("starts a message at the first committed partial and ends it with the converted entry on abort", async () => {
    const setup = chatSetup({ tokensPerSecond: 100, tokenSize: { min: 1, max: 1 } });
    setup.faux.setResponses([fauxAssistantMessage([fauxText("x".repeat(400))])]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const { stream, events } = await listen(harness, root);
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    await waitFor(() =>
      events().some(
        (event) => event.type === "message_start" && event.message.role === "assistant",
      ),
    );
    const live = await harness.snapshot(LiveDoc, root.id, context);
    await harness.abortTask(live!.run!.taskId, context);
    await submission.wait(context);
    await drained();
    const assistantEnds = events().filter(
      (event) => event.type === "message_end" && event.entry?.kind === "msa.assistant",
    );
    expect(assistantEnds).toHaveLength(1);
    expect(
      events().filter(
        (event) => event.type === "message_start" && event.message.role === "assistant",
      ),
    ).toHaveLength(1);
    await stream.stop();
    await harness.close(context);
  });
});
