import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";
import ContextHandlerSystemMessagesSupport from "./9789-context-handler-system-messages-support.ts";

const { fauxAssistantMessage, getCurrentSystemPrompt } = ai;

const { captureRequest, compactSession, compactViaHook, toolNames } =
  ContextHandlerSystemMessagesSupport;

const { createHarness } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

const keepsThePromptAndToolsWhen = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const seen: agentTypes.AgentMessage[][] = [];
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
                  content: [{ text: "injected", type: "text" }],
                  role: "user",
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
                { content: "ephemeral reminder", role: "system", timestamp: 0 },
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

const keepsThePromptAndToolsWhenA = () => Effect.runPromise(keepsThePromptAndToolsWhen);

const keepsMidConversationSystemMessagesInPlace = () =>
  Effect.runPromise(keepsMidConversationSystemMessagesIn);

const appliesInPlaceEditsToEventMessages = () => Effect.runPromise(appliesInPlaceEditsToEvent);

const keepsSystemMessagesAHandlerAddsAfter = () =>
  Effect.runPromise(keepsSystemMessagesAHandlerAdds);

describe("context handlers and system messages", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it(
    "keeps the prompt and tools when a handler slices from the compaction summary",
    keepsThePromptAndToolsWhenA,
  );
  it(
    "keeps mid-conversation system messages in place when a handler leaves the conversation unchanged",
    keepsMidConversationSystemMessagesInPlace,
  );
  it(
    "applies in-place edits to event.messages without a return value",
    appliesInPlaceEditsToEventMessages,
  );
  it(
    "keeps system messages a handler adds after the replayed head",
    keepsSystemMessagesAHandlerAddsAfter,
  );
});
