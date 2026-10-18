import {
  type AssistantMessage,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  Type,
} from "@msa/ai";
import { type AgentEvent, defineTool, type LiveState } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { type ChatSetup, chatSetup, openChat, textOf, waitFor } from "./chat-support.ts";
import { listen, drained } from "./harness-events-support.ts";
import { addTool } from "./harness-support.ts";
import { context, documentChanges } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

function slow(): ChatSetup {
  return chatSetup({ tokensPerSecond: 400, tokenSize: { min: 1, max: 1 } });
}

// Rebuild the streamed text of block 0 from `message_start` and the text deltas that follow it.
function streamedText(events: readonly AgentEvent[]): string {
  let text = "";
  for (const event of events) {
    if (event.type === "message_start" && event.message.role === "assistant") {
      const block = event.message.content[0];
      text = block?.type === "text" ? block.text : "";
    }
    if (event.type !== "message_update") continue;
    for (const change of event.changes) {
      if (
        change.type === "text_start" &&
        change.contentIndex === 0 &&
        change.block.type === "text"
      ) {
        text = change.block.text;
      }
      if (change.type === "text_delta" && change.contentIndex === 0) text += change.delta;
    }
  }
  return text;
}

async function streamingRun() {
  const setup = slow();
  const text = "streamed answer text ".repeat(20);
  setup.faux.setResponses([fauxAssistantMessage([fauxText(text)])]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  const { stream, events } = await listen(harness, root);
  expect(stream.snapshot).toMatchObject({ type: "snapshot", entries: [], tools: [], inbox: [] });
  const partials: string[] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      const message = (change.value as LiveState | null)?.generation?.message as
        | AssistantMessage
        | undefined;
      if (change.record.kind === "msa.live" && message !== undefined)
        partials.push(textOf(message) ?? "");
    }
  });
  return { text, harness, root, stream, events, partials };
}

async function toolOutputRun() {
  const setup = chatSetup();
  const gate = deferred();
  addTool(
    setup.registry,
    defineTool({
      name: "print",
      description: "Prints",
      parameters: Type.Object({ n: Type.Number() }),
      execute: async (_args, api) => {
        api.output("one\n");
        await new Promise((resolve) => {
          setTimeout(resolve, 150);
        });
        api.output("two\n");
        await gate.promise;
        return {};
      },
    }),
  );
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("print", { n: 1 }, { id: "c1" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  const { stream, events } = await listen(harness, root);
  return { gate, harness, root, stream, events };
}

describe("agent events", () => {
  it("streams a run as lifecycle events and text deltas that rebuild the answer", async () => {
    const { text, harness, root, stream, events, partials } = await streamingRun();
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    await submission.wait(context);
    await drained();
    const all = events();
    const types = all
      .map((event) => event.type)
      .filter((type, index, list) => type !== list[index - 1]);
    expect(types).toEqual([
      "message_start",
      "message_end",
      "submission",
      "run_start",
      "turn_start",
      "message_start",
      "message_update",
      "message_end",
      "turn_end",
      "run_end",
      "submission",
      "usage_changed",
    ]);
    expect(all.find((event) => event.type === "run_start")).toEqual({
      type: "run_start",
      inputs: [submission.id],
    });
    // After each event, the rebuilt text equals the committed partial of that commit.
    const rebuilt = all.flatMap((event, index) =>
      (event.type === "message_start" && event.message.role === "assistant") ||
      event.type === "message_update"
        ? [streamedText(all.slice(0, index + 1))]
        : [],
    );
    expect(rebuilt).toEqual(partials);
    expect(partials.length).toBeGreaterThan(1);
    const end = all.filter((event) => event.type === "message_end").at(-1)!;
    expect(end.type === "message_end" && textOf(end.entry!.model![0])).toBe(text);
    await stream.stop();
    await harness.close(context);
  });
});

describe("agent events", () => {
  it("reports tool start, output appends, and the result entry", async () => {
    const { gate, harness, root, stream, events } = await toolOutputRun();
    const submission = await root.submit({ type: "input", content: "go" }, context);
    // The output events rebuild the slot's retained window.
    const output = (): string => {
      let text = "";
      for (const event of events()) {
        if (event.type !== "tool_execution_update" || event.output === undefined) continue;
        if ("set" in event.output) text = event.output.set;
        else text = text.slice(event.output.trimStart ?? 0) + (event.output.append ?? "");
      }
      return text;
    };
    await waitFor(() => output() === "one\ntwo\n");
    gate.resolve();
    await submission.wait(context);
    await drained();
    const tool = events().filter((event) => event.type.startsWith("tool_execution"));
    expect(tool[0]).toEqual({
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "print",
      taskId: expect.any(Number),
      args: { n: 1 },
    });
    const end = tool.at(-1)!;
    expect(end).toMatchObject({
      type: "tool_execution_end",
      toolCallId: "c1",
      entry: { kind: "msa.tool-result" },
    });
    // As in the coding agent, the tool ends directly before its result message.
    const all = events();
    const endIndex = all.indexOf(end);
    expect(all.slice(endIndex, endIndex + 3).map((event) => event.type)).toEqual([
      "tool_execution_end",
      "message_start",
      "message_end",
    ]);
    expect(all[endIndex + 1]).toMatchObject({ message: { role: "toolResult", toolCallId: "c1" } });
    // Two turns: the tool round, and the answer.
    expect(events().filter((event) => event.type === "turn_start")).toHaveLength(2);
    expect(events().filter((event) => event.type === "turn_end")).toHaveLength(2);
    await stream.stop();
    await harness.close(context);
  });
});

describe("agent events", () => {
  it("reports queued submissions, inbox changes, and retries", async () => {
    const setup = chatSetup();
    const release = deferred();
    const held: FauxResponseStep = async (_request, options) => {
      await Promise.race([release.promise, aborted(options!.signal!)]);
      return fauxAssistantMessage([fauxText("first")]);
    };
    const error = fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "503 Service Unavailable",
    });
    setup.faux.setResponses([held, error, fauxAssistantMessage([fauxText("second")])]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    setup.settings.retry = { enabled: true, maxRetries: 1, baseDelayMs: 1 };
    const { stream, events } = await listen(harness, root);
    await root.submit({ type: "input", content: "a" }, context);
    const followUp = await root.submit({ type: "input", content: "f" }, context);
    await drained();
    expect(events().filter((event) => event.type === "inbox_update")).toEqual([
      { type: "inbox_update", items: [{ id: followUp.id, mode: "followUp" }] },
    ]);
    release.resolve();
    await followUp.wait(context);
    await drained();
    const types = events().map((event) => event.type);
    expect(types).toContain("auto_retry_start");
    expect(types).toContain("auto_retry_end");
    expect(types.filter((type) => type === "run_start")).toHaveLength(2);
    expect(
      events()
        .filter((event) => event.type === "submission")
        .map((event) => event.record.status),
    ).toEqual(["placed", "queued", "done", "placed", "done"]);
    await stream.stop();
    await harness.close(context);
  });
});

describe("agent events", () => {
  it("replaces undelivered batches with one snapshot after 100 pending batches", async () => {
    const { harness, root } = await openChat(new MemoryStorage(), chatSetup());
    const stream = await watchEvents(harness, root.id, context);
    for await (const _ of Array.from({ length: 101 })) {
      await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    }
    const batches: AgentEvent[][] = [];
    stream.start((events) => {
      batches.push([...events]);

      return Promise.resolve();
    });
    await drained();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]![0]).toMatchObject({ type: "snapshot" });
    expect((batches[0]![0] as Extract<AgentEvent, { type: "snapshot" }>).entries).toHaveLength(101);
    await stream.stop();
    await harness.close(context);
  });
});
