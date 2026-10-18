import {
  type AssistantMessage,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  Type,
} from "@msa/ai";
import { defineTool, type Harness, LiveDoc, type LiveState } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { listen, drained, applyChanges } from "./harness-events-support.ts";
import { addTool } from "./harness-support.ts";
import { context, documentChanges } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

function partialsOf(harness: Harness): AssistantMessage[] {
  const partials: AssistantMessage[] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      const message = (change.value as LiveState | null)?.generation?.message as
        | AssistantMessage
        | undefined;
      if (change.record.kind === "msa.live" && message !== undefined) partials.push(message);
    }
  });
  return partials;
}

const trimmingToolRun = Effect.fn("trimmingToolRun")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const gate = deferred();
  addTool(
    setup.registry,
    defineTool({
      name: "tail",
      description: "Prints lines",
      parameters: Type.Object({}),
      outputLimits: { maxLines: 3, retain: "tail" },
      execute: (_args, api) =>
        runPromise(
          Effect.gen(function* () {
            for (const line of Array.from({ length: 6 }, (_, i) => i)) {
              api.output(`line ${line}\n`);
              yield* Effect.sleep(120);
            }
            yield* awaited(gate.promise);
            return {};
          }),
        ),
    }),
  );
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("tail", {}, { id: "c1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const outputs: string[] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      const output = (change.value as LiveState | null)?.tools?.[0]?.output;
      if (change.record.kind === "msa.live" && output !== undefined && output !== outputs.at(-1)) {
        outputs.push(output);
      }
    }
  });
  const { stream, events } = yield* listen(harness, root);
  return { gate, harness, root, outputs, stream, events };
});

const neverRunCallSetup = Effect.fn("neverRunCallSetup")(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    defineTool({
      name: "wait",
      description: "Waits until aborted",
      parameters: Type.Object({}),
      execute: (_args, _api, callContext) => aborted(callContext.abortSignal!),
    }),
  );
  setup.faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("ghost", {}, { id: "c1" }), fauxToolCall("wait", {}, { id: "c2" })],
      {
        stopReason: "toolUse",
      },
    ),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { stream, events } = yield* listen(harness, root);
  return { harness, root, stream, events };
});

const rebuildsEveryCommitted = Effect.gen(function* () {
  const setup = chatSetup({ tokensPerSecond: 150, tokenSize: { min: 1, max: 1 } });
  const message = fauxAssistantMessage(
    [
      fauxThinking("thinking about it ".repeat(10)),
      fauxText("some text ".repeat(10)),
      fauxToolCall(
        "missing",
        { path: "a/long/path/".repeat(10), note: "x".repeat(60) },
        { id: "c1" },
      ),
    ],
    { stopReason: "toolUse" },
  );
  setup.faux.setResponses([message, fauxAssistantMessage([fauxText("done")])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const partials = partialsOf(harness);
  const { stream, events } = yield* listen(harness, root);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  yield* drained();
  const rebuilt: AssistantMessage[] = [];
  let current: AssistantMessage | undefined;
  for (const event of events()) {
    if (event.type === "message_end" && event.entry?.kind === "msa.assistant") break;
    if (event.type === "message_start" && event.message.role === "assistant")
      current = event.message;
    else if (event.type === "message_update") current = applyChanges(current!, event.changes);
    else continue;
    rebuilt.push(current!);
  }
  expect(partials.length).toBeGreaterThan(2);
  expect(rebuilt.map((partial) => partial.content)).toEqual(
    partials.map((partial) => partial.content),
  );
  const types = new Set(
    events()
      .flatMap((event) => (event.type === "message_update" ? event.changes : []))
      .map((c) => c.type),
  );
  expect(types.has("thinking_delta") || types.has("text_delta")).toBe(true);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("rebuilds every committed partial of thinking, text, and tool-call arguments from message changes", () =>
    Effect.runPromise(rebuildsEveryCommitted));
});

const rebuildsSlidingTail = Effect.gen(function* () {
  const { gate, harness, root, outputs, stream, events } = yield* trimmingToolRun();
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* waitFor(() => outputs.at(-1)?.endsWith("line 5\n") === true);
  gate.resolve();
  yield* awaited(submission.wait(context));
  yield* drained();
  const rebuilt: string[] = [];
  let text = "";
  for (const event of events()) {
    if (event.type !== "tool_execution_update" || event.output === undefined) continue;
    if ("set" in event.output) text = event.output.set;
    else text = text.slice(event.output.trimStart ?? 0) + (event.output.append ?? "");
    rebuilt.push(text);
  }
  expect(rebuilt).toEqual(outputs);
  expect(
    events().some(
      (event) => event.type === "tool_execution_update" && "trimStart" in (event.output ?? {}),
    ),
  ).toBe(true);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("rebuilds a sliding tail window from output trims and appends", () =>
    Effect.runPromise(rebuildsSlidingTail));
});

const emitsOneExact = Effect.gen(function* () {
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
  setup.faux.setResponses([held, fauxAssistantMessage([fauxText("second")])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  const followUp = yield* awaited(root.submit({ type: "input", content: "f" }, context));
  const { stream, batches } = yield* listen(harness, root);
  release.resolve();
  yield* awaited(followUp.wait(context));
  yield* drained();
  const boundary = batches.find((batch) => batch.some((event) => event.type === "run_end"))!;
  expect(boundary.map((event) => event.type)).toEqual([
    "message_start",
    "message_end",
    "message_start",
    "message_end",
    "turn_end",
    "run_end",
    "submission",
    "submission",
    "inbox_update",
    "usage_changed",
    "run_start",
    "turn_start",
  ]);
  expect(
    boundary.filter((event) => event.type === "submission").map((event) => event.record.id),
  ).toEqual([input.id, followUp.id]);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("emits one exact batch when a run ends and a queued follow-up starts the next", () =>
    Effect.runPromise(emitsOneExact));
});

const endsCallNever = Effect.gen(function* () {
  const { harness, root, stream, events } = yield* neverRunCallSetup();
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* waitFor(() => events().some((event) => event.type === "tool_execution_start"));
  yield* awaited(
    harness.abortTask(
      (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.run!.taskId,
      context,
    ),
  );
  yield* awaited(submission.wait(context));
  yield* drained();
  const round = events().map((event) =>
    event.type === "message_end"
      ? `end:${event.entry.kind}`
      : event.type === "message_start"
        ? `start:${event.message.role}`
        : event.type,
  );
  const ghostEnd = round.indexOf("tool_execution_end");
  expect(round.slice(ghostEnd - 1, ghostEnd + 3)).toEqual([
    "end:msa.assistant",
    "tool_execution_end",
    "start:toolResult",
    "end:msa.tool-result",
  ]);
  const tool = events().filter((event) => event.type.startsWith("tool_execution"));
  expect(
    tool.map((event) => [event.type, "toolCallId" in event && event.toolCallId, "entry" in event]),
  ).toEqual([
    ["tool_execution_end", "c1", true],
    ["tool_execution_start", "c2", false],
    ["tool_execution_end", "c2", true],
  ]);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("ends a call that never runs and a tool aborted with its generation", () =>
    Effect.runPromise(endsCallNever));
});
