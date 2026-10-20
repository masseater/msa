import type { AgentMessage, AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { convertToLlm } from "../../../src/core/messages.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

function roles(messages: AgentMessage[]): string[] {
  return messages.map((message) => message.role);
}

const harnesses: harnessTypes.Harness[] = [];

const appendsTheMessageAfterTheTurn = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let notify: (() => Promise<void>) | undefined;
  const slowTool: AgentTool = {
    description: "Wait for a background task",
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => Promise.resolve(notify?.()));
          return { content: [{ text: "tool done", type: "text" }], details: {} };
        }),
      ),
    label: "Wait",
    name: "wait",
    parameters: Type.Object({}),
  };

  const harness = yield* Effect.promise(() => createHarness({ tools: [slowTool] }));
  harnesses.push(harness);
  notify = () =>
    harness.session.sendCustomMessage(
      { content: "subagent replied", customType: "subagent-reply", display: true },
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
    description: "Wait for a background task",
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => Promise.resolve(notify?.()));
          return { content: [{ text: "tool done", type: "text" }], details: {} };
        }),
      ),
    label: "Wait",
    name: "wait",
    parameters: Type.Object({}),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [slowTool] }));
  harnesses.push(harness);
  notify = () =>
    harness.session.sendCustomMessage(
      { content: "subagent replied", customType: "subagent-reply", display: true },
      { triggerTurn: false },
    );
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("hi"));
  return yield* keepsSessionEntriesAndMessageEventsStep1(harness);
});

const keepsSessionEntriesAndMessageEventsStep1 = (harness: harnessTypes.Harness) =>
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
    description: "Wait for a background task",
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => Promise.resolve(notify?.()));
          return { content: [{ text: "tool done", type: "text" }], details: {} };
        }),
      ),
    label: "Wait",
    name: "wait",
    parameters: Type.Object({}),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [slowTool] }));
  harnesses.push(harness);
  notify = () =>
    harness.session.sendCustomMessage(
      { content: "subagent replied", customType: "subagent-reply", display: true },
      { triggerTurn: false },
    );
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("second turn"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("hi"));
  return yield* producesAnLlmHistoryWhereEveryStep1(harness);
});

const producesAnLlmHistoryWhereEveryStep1 = (harness: harnessTypes.Harness) =>
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

const appendsTheMessageAfterTheTurnS = () => Effect.runPromise(appendsTheMessageAfterTheTurn);

const keepsSessionEntriesAndMessageEventsIn = () =>
  Effect.runPromise(keepsSessionEntriesAndMessageEvents);

const producesAnLlmHistoryWhereEveryTool = () => Effect.runPromise(producesAnLlmHistoryWhereEvery);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("#8537 custom messages injected during tool execution", () => {
  afterEach(afterEachHook);
  it(
    "appends the message after the turn's tool results instead of between call and result",
    appendsTheMessageAfterTheTurnS,
  );
  it(
    "keeps session entries and message events in the same order as agent state",
    keepsSessionEntriesAndMessageEventsIn,
  );
  it(
    "produces an llm history where every tool result follows its tool call",
    producesAnLlmHistoryWhereEveryTool,
  );
});
