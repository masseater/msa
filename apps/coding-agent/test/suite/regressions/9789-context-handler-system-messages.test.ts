import type { AgentMessage } from "@msa/agent-core";
import {
  fauxAssistantMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  type TranscriptContext,
} from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { ExtensionFactory } from "../../../src/index.ts";
import { createHarness, type Harness } from "../harness.ts";

const compactViaHook: ExtensionFactory = (msa) => {
  msa.on("session_before_compact", (event) =>
    Promise.resolve({
      compaction: {
        summary: "extension summary",
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details: { source: "test" },
      },
    }),
  );
};

function captureRequest(harness: Harness, text: string): () => TranscriptContext {
  let request: TranscriptContext | undefined;
  harness.setResponses([
    (context) => {
      request = context;
      return fauxAssistantMessage(text);
    },
  ]);
  return () => {
    if (request === undefined) throw new Error("expected a provider request");
    return request;
  };
}

function toolNames(context: TranscriptContext): string[] {
  return getCurrentTools(context.messages).map((tool) => tool.name);
}

function compactSession(harness: Harness): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
      harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
      yield* Effect.promise(() => harness.session.prompt("first"));
      yield* Effect.promise(() => harness.session.prompt("second"));
      yield* Effect.promise(() => harness.session.compact());
      expect(harness.session.messages.map((message) => message.role).slice(0, 2)).toEqual([
        "system",
        "compactionSummary",
      ]);
    }),
  );
}

const harnesses: Harness[] = [];

const keepsThePromptAndToolsWhen = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const seen: AgentMessage[][] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        compactViaHook,
        (msa) => {
          msa.on("context", (event) =>
            runPromise(
              Effect.sync(() => {
                seen.push(event.messages);
                const summary = event.messages.findIndex(
                  (message) => message.role === "compactionSummary",
                );
                return { messages: event.messages.slice(summary) };
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  yield* Effect.promise(() => compactSession(harness));
  const getRequest = captureRequest(harness, "after compaction");

  yield* Effect.promise(() => harness.session.prompt("third"));

  const request = getRequest();
  expect(seen.at(-1)?.some((message) => message.role === "system")).toBe(false);
  expect(request.messages[0]?.role).toBe("system");
  expect(toolNames(request)).toEqual(harness.session.getActiveToolNames());
  expect(getCurrentSystemPrompt(request.messages)).toBe(harness.session.systemPrompt);
  expect(request.messages.filter((message) => message.role === "system")).toHaveLength(1);
});

const keepsMidConversationSystemMessagesIn = Effect.gen(function* () {
  let turn = 0;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", (event) => {
            if (++turn === 2) event.systemPromptOptions.sections["plan_mode"] = "Plan only.";
          });
          msa.on("context", (event) => Promise.resolve({ messages: event.messages }));
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("one")]);
  yield* Effect.promise(() => harness.session.prompt("first"));
  const getRequest = captureRequest(harness, "two");

  yield* Effect.promise(() => harness.session.prompt("second"));

  const systemMessages = getRequest().messages.filter((message) => message.role === "system");
  expect(systemMessages).toHaveLength(2);
  expect(systemMessages[1]?.sections).toEqual({
    plan_mode: "<plan_mode>\nPlan only.\n</plan_mode>",
  });
});

const appliesInPlaceEditsToEvent = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("context", (event) =>
            runPromise(
              Effect.sync(() => {
                event.messages.splice(0, 0, {
                  role: "user",
                  content: [{ type: "text", text: "injected" }],
                  timestamp: 0,
                });
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  const getRequest = captureRequest(harness, "done");

  yield* Effect.promise(() => harness.session.prompt("hello"));

  const request = getRequest();
  expect(request.messages.map((message) => message.role)).toEqual(["system", "user", "user"]);
  expect(toolNames(request)).toEqual(harness.session.getActiveToolNames());
});

const keepsSystemMessagesAHandlerAdds = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("context", (event) =>
            Promise.resolve({
              messages: [
                { role: "system", content: "ephemeral reminder", timestamp: 0 },
                ...event.messages,
              ],
            }),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  const getRequest = captureRequest(harness, "done");

  yield* Effect.promise(() => harness.session.prompt("hello"));

  const request = getRequest();
  expect(request.messages.map((message) => message.role)).toEqual(["system", "system", "user"]);
  expect(toolNames(request)).toEqual(harness.session.getActiveToolNames());
  expect(getCurrentSystemPrompt(request.messages)).toContain(harness.session.systemPrompt);
  expect(getCurrentSystemPrompt(request.messages)).toContain("ephemeral reminder");
});

describe("context handlers and system messages", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it("keeps the prompt and tools when a handler slices from the compaction summary", () =>
    Effect.runPromise(keepsThePromptAndToolsWhen));
  it("keeps mid-conversation system messages in place when a handler leaves the conversation unchanged", () =>
    Effect.runPromise(keepsMidConversationSystemMessagesIn));
  it("applies in-place edits to event.messages without a return value", () =>
    Effect.runPromise(appliesInPlaceEditsToEvent));
  it("keeps system messages a handler adds after the replayed head", () =>
    Effect.runPromise(keepsSystemMessagesAHandlerAdds));
});

const harnesses3: Harness[] = [];

const runsAfterContextHandlersOnThe = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const seen: AgentMessage[][] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        compactViaHook,
        (msa) => {
          msa.on("context_with_system", (event) =>
            runPromise(
              Effect.sync(() => {
                seen.push(event.messages);
                return {
                  messages: event.messages.map((message) =>
                    message.role === "system" && message.toolsAdded !== undefined
                      ? {
                          ...message,
                          toolsAdded: message.toolsAdded.filter((tool) => tool.name !== "bash"),
                        }
                      : message,
                  ),
                };
              }),
            ),
          );

          msa.on("context", (event) =>
            runPromise(
              Effect.sync(() => {
                const summary = event.messages.findIndex(
                  (message) => message.role === "compactionSummary",
                );
                return { messages: event.messages.slice(summary) };
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses3.push(harness);
  yield* Effect.promise(() => compactSession(harness));
  const getRequest = captureRequest(harness, "after compaction");

  yield* Effect.promise(() => harness.session.prompt("third"));

  const input = seen.at(-1);
  expect(input?.[0]?.role).toBe("system");
  expect(input?.[1]?.role).toBe("compactionSummary");
  expect(harness.session.getActiveToolNames()).toContain("bash");
  expect(toolNames(getRequest())).toEqual(
    harness.session.getActiveToolNames().filter((name) => name !== "bash"),
  );
});

const reportsAHandlerThatDropsThe = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("context_with_system", (event) =>
            Promise.resolve({
              messages: event.messages.filter((message) => message.role !== "system"),
            }),
          );
        },
      ],
    }),
  );
  harnesses3.push(harness);
  const errors: string[] = [];
  harness.session.extensionRunner.onError((error) => {
    errors.push(`${error.event}: ${error.error}`);
  });
  const getRequest = captureRequest(harness, "done");

  yield* Effect.promise(() => harness.session.prompt("hello"));

  expect(getRequest().messages.map((message) => message.role)).toEqual(["user"]);
  expect(errors).toEqual([
    expect.stringMatching(/^context_with_system: Handler removed the leading system message/u),
  ]);
});

describe("context_with_system handlers", () => {
  afterEach(() => {
    while (harnesses3.length > 0) harnesses3.pop()?.cleanup();
  });
  it("runs after context handlers on the restored transcript and sends its output verbatim", () =>
    Effect.runPromise(runsAfterContextHandlersOnThe));
  it("reports a handler that drops the leading system message but honors its output", () =>
    Effect.runPromise(reportsAHandlerThatDropsThe));
});
