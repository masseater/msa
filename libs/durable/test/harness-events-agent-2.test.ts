import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import type { Draft } from "@msa/chord";
import {
  AgentDoc,
  type AgentEvent,
  type AgentEventStream,
  defineTool,
  LiveDoc,
  type LiveState,
  type SnapshotEvent,
  UsageDoc,
} from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { type LiveMessage } from "./harness-events-agent-2-cases.ts";
import { listen, drained, applyChanges } from "./harness-events-support.ts";
import {
  chatSetup,
  openChat,
  waitFor,
  abortController,
  awaited,
  fromJsonText,
  toJsonText,
  addTool,
  context,
  deferred,
} from "./support.ts";

const liveChangeSequence = Effect.fn("liveChangeSequence")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const { stream, batches } = yield* listen(harness, root);
  const change = (edit: (live: Draft<LiveState>) => void) =>
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return edit(yield* awaited(tx.doc(LiveDoc, root.id)));
          }),
        ),
      context,
    );
  const partial = (yield* fromJsonText(
    yield* toJsonText(fauxAssistantMessage([fauxText("partial")])),
  )) as LiveMessage;
  yield* awaited(
    change((live) => {
      live.generation = { attempt: 1, message: partial };
    }),
  );
  yield* awaited(
    change((live) => {
      live.generation!.message!.usage.input = 42;
    }),
  );
  yield* awaited(
    change((live) => {
      live.generation = { attempt: 1, deferred: { pollAt: 1 } };
    }),
  );
  yield* awaited(
    change((live) => {
      live.generation!.deferred!.pollAt = 2;
    }),
  );
  yield* awaited(
    change((live) => {
      live.tools = [
        { callId: "c1", name: "t", status: "running", details: { n: 1 }, diagnostics: [] },
      ];
    }),
  );
  yield* awaited(
    change((live) => {
      delete live.tools![0]!.details;
      delete live.tools![0]!.diagnostics;
    }),
  );
  yield* awaited(
    change((live) => {
      live.tools![0]!.status = "done";
    }),
  );
  return { harness, root, stream, batches, partial };
});

const reportsSteerWithout = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const gate = deferred();
  addTool(
    setup.registry,
    defineTool({
      name: "hold",
      description: "Waits",
      parameters: Type.Object({}),
      execute: () =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(gate.promise);
            return {};
          }),
        ),
    }),
  );
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("hold", {}, { id: "c1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const other = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  const { stream, events, batches } = yield* listen(harness, root);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* waitFor(() => events().some((event) => event.type === "tool_execution_start"));
  yield* awaited(root.submit({ type: "input", content: "s", whenBusy: "steer" }, context));
  const before = batches.length;
  yield* awaited(other.commit((tx) => tx.appendEntry(other.id, { kind: "note" }), context));
  yield* drained();
  expect(batches.length).toBe(before);
  gate.resolve();
  yield* awaited(input.wait(context));
  yield* awaited(root.reset(undefined, context));
  yield* drained();
  expect(events().filter((event) => event.type === "run_start")).toHaveLength(1);
  expect(events().filter((event) => event.type === "run_end")).toHaveLength(1);
  expect(batches.at(-1)!.map((event) => event.type)).toEqual(["entry_appended", "submission"]);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("reports a steer without run events, a reset as an appended entry, and nothing for other conversations", () =>
    Effect.runPromise(reportsSteerWithout));
});

const rejectsAttachmentCancelled = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const release = deferred();
  const blocking = root.commit(
    () => runPromise(Effect.asVoid(Effect.suspend(() => awaited(release.promise)))),
    context,
  );
  const controller = abortController();
  const attaching = watchEvents(harness, root.id, {
    ...context,
    abortSignal: controller.signal,
  });
  controller.abort(new Error("cancelled"));
  release.resolve();
  yield* awaited(blocking);
  yield* awaited(expect(attaching).rejects.toThrow("cancelled"));
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("rejects an attachment cancelled while it waits for the Session line", () =>
    Effect.runPromise(rejectsAttachmentCancelled));
});

const appliesDeltasOverflowStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const partial = fauxAssistantMessage([fauxText("hel")]);
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, root.id))).generation = {
              attempt: 1,
              message: (yield* fromJsonText(yield* toJsonText(partial))) as LiveMessage,
            };
          }),
        ),
      context,
    ),
  );
  for (const _ of Array.from({ length: 101 })) {
    yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  }
  const batches: AgentEvent[][] = [];
  stream.start((events) => {
    batches.push([...events]);

    return Promise.resolve();
  });
  yield* drained();
  const snapshot = batches[0]![0] as SnapshotEvent;
  expect(snapshot.type).toBe("snapshot");
  return { runPromise, harness, root, stream, batches, snapshot };
});

const appliesDeltasOverflow = Effect.gen(function* () {
  const { runPromise, harness, root, stream, batches, snapshot } =
    yield* appliesDeltasOverflowStep1;
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const block = (yield* awaited(tx.doc(LiveDoc, root.id))).generation!.message!
              .content[0] as {
              text: string;
            };
            block.text += "lo";
          }),
        ),
      context,
    ),
  );
  yield* drained();
  const update = batches.at(-1)![0]!;
  if (update.type !== "message_update") throw new Error(`Unexpected ${update.type}`);
  expect(update.changes).toEqual([{ type: "text_delta", contentIndex: 0, delta: "lo" }]);
  const rebuilt = applyChanges(snapshot.generation!.message!, update.changes);
  expect(rebuilt.content).toEqual([{ type: "text", text: "hello" }]);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("applies deltas after an overflow snapshot that holds an in-flight partial", () =>
    Effect.runPromise(appliesDeltasOverflow));
});

const reportsUsageOnly = Effect.gen(function* () {
  const { harness, root, stream, batches, partial } = yield* liveChangeSequence();
  yield* awaited(root.commit((tx) => tx.retireDoc(UsageDoc, root.id), context));
  yield* awaited(root.commit((tx) => tx.retireDoc(AgentDoc, root.id), context));
  yield* drained();
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
    [{ type: "usage_changed", usage: { models: {}, tools: {} } }],
    [{ type: "agent_changed", agent: {} }],
  ]);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

const endsStreamHarness = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const stream: AgentEventStream = yield* awaited(watchEvents(harness, root.id, context));
  yield* awaited(harness.close(context));
  expect(yield* awaited(stream.closed)).toEqual({ reason: "session_closed" });
});

describe("agent events", () => {
  it("reports usage-only updates, cleared tool progress, tools ending without entries, and deferred polls", () =>
    Effect.runPromise(reportsUsageOnly));

  it("ends the stream with the Harness", () => Effect.runPromise(endsStreamHarness));
});
