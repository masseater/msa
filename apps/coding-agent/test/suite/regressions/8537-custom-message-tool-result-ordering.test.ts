import type { AgentMessage, AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { convertToLlm } from "../../../src/core/messages.ts";
import { createHarness, type Harness } from "../harness.ts";

function roles(messages: AgentMessage[]): string[] {
  return messages.map((message) => message.role);
}

const harnesses: Harness[] = [];

const appendsTheMessageAfterTheTurn = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let notify: (() => Promise<void>) | undefined;
  const slowTool: AgentTool = {
    name: "wait",
    label: "Wait",
    description: "Wait for a background task",
    parameters: Type.Object({}),
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => Promise.resolve(notify?.()));
          return { content: [{ type: "text", text: "tool done" }], details: {} };
        }),
      ),
  };

  const harness = yield* Effect.promise(() => createHarness({ tools: [slowTool] }));
  harnesses.push(harness);
  notify = () =>
    harness.session.sendCustomMessage(
      { customType: "subagent-reply", content: "subagent replied", display: true },
      { triggerTurn: false },
    );

  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("hi"));

  expect(roles(harness.session.messages)).toEqual([
    "system",
    "user",
    "assistant",
    "toolResult",
    "custom",
    "assistant",
  ]);
});

const keepsSessionEntriesAndMessageEvents = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let notify: (() => Promise<void>) | undefined;
  const slowTool: AgentTool = {
    name: "wait",
    label: "Wait",
    description: "Wait for a background task",
    parameters: Type.Object({}),
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => Promise.resolve(notify?.()));
          return { content: [{ type: "text", text: "tool done" }], details: {} };
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [slowTool] }));
  harnesses.push(harness);
  notify = () =>
    harness.session.sendCustomMessage(
      { customType: "subagent-reply", content: "subagent replied", display: true },
      { triggerTurn: false },
    );
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("hi"));
  return yield* keepsSessionEntriesAndMessageEventsPart2(harness);
});

const keepsSessionEntriesAndMessageEventsPart2 = (harness: Harness) =>
  Effect.sync(() => {
    const entryKinds = harness.sessionManager
      .getBranch()
      .flatMap((entry) =>
        entry.type === "message"
          ? [entry.message.role]
          : entry.type === "custom_message"
            ? ["custom"]
            : [],
      );
    expect(entryKinds).toEqual([
      "system",
      "user",
      "assistant",
      "toolResult",
      "custom",
      "assistant",
    ]);
    const messageStarts = harness.events.flatMap((event) =>
      event.type === "message_start" ? [event.message.role] : [],
    );
    expect(messageStarts).toEqual([
      "system",
      "user",
      "assistant",
      "toolResult",
      "custom",
      "assistant",
    ]);
  });

const producesAnLlmHistoryWhereEvery = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let notify: (() => Promise<void>) | undefined;
  const slowTool: AgentTool = {
    name: "wait",
    label: "Wait",
    description: "Wait for a background task",
    parameters: Type.Object({}),
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => Promise.resolve(notify?.()));
          return { content: [{ type: "text", text: "tool done" }], details: {} };
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [slowTool] }));
  harnesses.push(harness);
  notify = () =>
    harness.session.sendCustomMessage(
      { customType: "subagent-reply", content: "subagent replied", display: true },
      { triggerTurn: false },
    );
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("second turn"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("hi"));
  return yield* producesAnLlmHistoryWhereEveryPart2(harness);
});

const producesAnLlmHistoryWhereEveryPart2 = (harness: Harness) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => harness.session.prompt("and now?"));
    const llmMessages = convertToLlm(harness.session.messages);
    const openToolCallIds = new Set<string>();
    for (const message of llmMessages) {
      if (message.role === "assistant") {
        openToolCallIds.clear();
        for (const block of message.content) {
          if (block.type === "toolCall") openToolCallIds.add(block.id);
        }
        continue;
      }
      if (message.role === "toolResult") {
        expect(openToolCallIds.has(message.toolCallId)).toBe(true);
        openToolCallIds.delete(message.toolCallId);
        continue;
      }
      openToolCallIds.clear();
    }
  });

describe("#8537 custom messages injected during tool execution", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("appends the message after the turn's tool results instead of between call and result", () =>
    Effect.runPromise(appendsTheMessageAfterTheTurn));
  it("keeps session entries and message events in the same order as agent state", () =>
    Effect.runPromise(keepsSessionEntriesAndMessageEvents));
  it("produces an llm history where every tool result follows its tool call", () =>
    Effect.runPromise(producesAnLlmHistoryWhereEvery));
});
