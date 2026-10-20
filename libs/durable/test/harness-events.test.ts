import {
  type AssistantMessage,
  type FauxResponseStep,
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessEventsSupport from "./harness-events-support.ts";
import support from "./support.ts";
import type supportTypes from "./support.types.ts";

const { MemoryStorage } = memory;
const { defineTool } = durable;
const { watchEvents } = harnessModule;

const { drained, listen } = harnessEventsSupport;
const {
  aborted,
  addTool,
  awaited,
  chatSetup,
  context,
  deferred,
  documentChanges,
  openChat,
  textOf,
  waitFor,
} = support;

function slow(): supportTypes.ChatSetup {
  return chatSetup({ tokenSize: { max: 1, min: 1 }, tokensPerSecond: 400 });
}

function streamedText(events: readonly durableTypes.AgentEvent[]): string {
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

const streamingRun = Effect.fn("streamingRun")(function* () {
  const setup = slow();
  const text = "streamed answer text ".repeat(20);
  setup.faux.setResponses([fauxAssistantMessage([fauxText(text)])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { stream, events } = yield* listen(harness, root);
  expect(stream.snapshot).toMatchObject({ entries: [], inbox: [], tools: [], type: "snapshot" });
  const partials: string[] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      const message = (change.value as durableTypes.LiveState | null)?.generation?.message as
        | AssistantMessage
        | undefined;
      if (change.record.kind === "msa.live" && message !== undefined)
        partials.push(textOf(message) ?? "");
    }
  });
  return { events, harness, partials, root, stream, text };
});

const toolOutputRun = Effect.fn("toolOutputRun")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const gate = deferred();
  addTool(
    setup.registry,
    defineTool({
      description: "Prints",
      execute: (_args, api) =>
        runPromise(
          Effect.gen(function* () {
            api.output("one\n");
            yield* Effect.sleep(150);
            api.output("two\n");
            yield* awaited(gate.promise);
            return {};
          }),
        ),
      name: "print",
      parameters: Type.Object({ n: Type.Number() }),
    }),
  );
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("print", { n: 1 }, { id: "c1" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { stream, events } = yield* listen(harness, root);
  return { events, gate, harness, root, stream };
});

const streamsRunLifecycle = Effect.gen(function* () {
  const { text, harness, root, stream, events, partials } = yield* streamingRun();
  const submission = yield* awaited(root.submit({ content: "hi", type: "input" }, context));
  yield* awaited(submission.wait(context));
  yield* drained();
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
    inputs: [submission.id],
    type: "run_start",
  });
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
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("streams a run as lifecycle events and text deltas that rebuild the answer", () =>
    Effect.runPromise(streamsRunLifecycle));
});

const reportsToolStart = Effect.gen(function* () {
  const { gate, harness, root, stream, events } = yield* toolOutputRun();
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  const output = (): string => {
    let text = "";
    for (const event of events()) {
      if (event.type !== "tool_execution_update" || event.output === undefined) continue;
      if ("set" in event.output) text = event.output.set;
      else text = text.slice(event.output.trimStart ?? 0) + (event.output.append ?? "");
    }
    return text;
  };
  yield* waitFor(() => output() === "one\ntwo\n");
  gate.resolve();
  yield* awaited(submission.wait(context));
  yield* drained();
  const tool = events().filter((event) => event.type.startsWith("tool_execution"));
  expect(tool[0]).toEqual({
    args: { n: 1 },
    taskId: expect.any(Number),
    toolCallId: "c1",
    toolName: "print",
    type: "tool_execution_start",
  });
  const end = tool.at(-1)!;
  expect(end).toMatchObject({
    entry: { kind: "msa.tool-result" },
    toolCallId: "c1",
    type: "tool_execution_end",
  });
  const all = events();
  const endIndex = all.indexOf(end);
  expect(all.slice(endIndex, endIndex + 3).map((event) => event.type)).toEqual([
    "tool_execution_end",
    "message_start",
    "message_end",
  ]);
  expect(all[endIndex + 1]).toMatchObject({
    message: { role: "toolResult", toolCallId: "c1" },
  });
  expect(events().filter((event) => event.type === "turn_start")).toHaveLength(2);
  expect(events().filter((event) => event.type === "turn_end")).toHaveLength(2);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("reports tool start, output appends, and the result entry", () =>
    Effect.runPromise(reportsToolStart));
});

const reportsQueuedSubmissions = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const release = deferred();
  const held: FauxResponseStep = (_request, options) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(Promise.race([release.promise, aborted(options!.signal!)]));
        return fauxAssistantMessage([fauxText("first")]);
      }),
    );
  const error = fauxAssistantMessage([], {
    errorMessage: "503 Service Unavailable",
    stopReason: "error",
  });
  setup.faux.setResponses([held, error, fauxAssistantMessage([fauxText("second")])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  setup.settings.retry = { baseDelayMs: 1, enabled: true, maxRetries: 1 };
  const { stream, events } = yield* listen(harness, root);
  yield* awaited(root.submit({ content: "a", type: "input" }, context));
  const followUp = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  yield* drained();
  expect(events().filter((event) => event.type === "inbox_update")).toEqual([
    { items: [{ id: followUp.id, mode: "followUp" }], type: "inbox_update" },
  ]);
  release.resolve();
  yield* awaited(followUp.wait(context));
  yield* drained();
  const types = events().map((event) => event.type);
  expect(types).toContain("auto_retry_start");
  expect(types).toContain("auto_retry_end");
  expect(types.filter((type) => type === "run_start")).toHaveLength(2);
  expect(
    events()
      .filter((event) => event.type === "submission")
      .map((event) => event.record.status),
  ).toEqual(["placed", "queued", "done", "placed", "done"]);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("reports queued submissions, inbox changes, and retries", () =>
    Effect.runPromise(reportsQueuedSubmissions));
});

const replacesUndeliveredBatches = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  for (const _ of Array.from({ length: 101 })) {
    yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  }
  const batches: durableTypes.AgentEvent[][] = [];
  stream.start((events) => {
    batches.push([...events]);

    return Promise.resolve();
  });
  yield* drained();
  expect(batches).toHaveLength(1);
  expect(batches[0]).toHaveLength(1);
  expect(batches[0]![0]).toMatchObject({ type: "snapshot" });
  expect(
    (batches[0]![0] as Extract<durableTypes.AgentEvent, { type: "snapshot" }>).entries,
  ).toHaveLength(101);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("replaces undelivered batches with one snapshot after 100 pending batches", () =>
    Effect.runPromise(replacesUndeliveredBatches));
});
