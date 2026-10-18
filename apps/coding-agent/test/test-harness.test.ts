import type { AgentTool } from "@msa/agent-core";
import type { AssistantMessage } from "@msa/ai";
import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createHarness, createHarnessWithExtensions, type Harness } from "./test-harness.ts";

describe("test harness", () => {
  let harness: Harness;

  afterEach(() => {
    harness?.cleanup();
  });

  it("simple text response", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(createHarness({ responses: ["hello world"] }));

        yield* awaited(harness.session.prompt("hi"));

        expect(harness.faux.callCount).toBe(1);

        const assistantMessages = harness.session.messages.filter((m) => m.role === "assistant");
        expect(assistantMessages).toHaveLength(1);

        const msg = assistantMessages[0] as AssistantMessage;
        expect(msg.content).toEqual([{ type: "text" as const, text: "hello world" }]);
        expect(msg.stopReason).toBe("stop");
      }),
    ));

  it("response sequence", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(createHarness({ responses: ["first", "second", "third"] }));

        yield* awaited(harness.session.prompt("a"));
        yield* awaited(harness.session.prompt("b"));
        yield* awaited(harness.session.prompt("c"));

        expect(harness.faux.callCount).toBe(3);

        const assistantTexts = harness.session.messages
          .filter((m): m is AssistantMessage => m.role === "assistant")
          .map((m) => m.content.find((c) => c.type === "text")?.text);

        expect(assistantTexts).toEqual(["first", "second", "third"]);
      }),
    ));

  it("tool call response triggers tool execution", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let toolExecuted = false;
        const echoTool: AgentTool = {
          name: "echo",
          label: "Echo",
          description: "Echo back",
          parameters: Type.Object({ text: Type.String() }),
          execute: () =>
            effectRunPromise(
              Effect.gen(function* () {
                toolExecuted = true;
                return yield* awaited({
                  content: [{ type: "text" as const, text: "echoed" }],
                  details: {},
                });
              }),
            ),
        };

        harness = yield* awaited(
          createHarness({
            responses: [{ toolCalls: [{ name: "echo", args: { text: "hi" } }] }, "done after tool"],
            tools: [echoTool],
            baseToolsOverride: { echo: echoTool },
          }),
        );

        yield* awaited(harness.session.prompt("use the tool"));

        expect(toolExecuted).toBe(true);
        expect(harness.faux.callCount).toBe(2);

        const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
        expect(toolResults).toHaveLength(1);
      }),
    ));

  it("error response", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(
          createHarness({
            responses: [{ error: "something broke" }],
          }),
        );

        yield* awaited(harness.session.prompt("hi"));

        const assistantMessages = harness.session.messages.filter(
          (m): m is AssistantMessage => m.role === "assistant",
        );
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]?.stopReason).toBe("error");
        expect(assistantMessages[0]?.errorMessage).toBe("something broke");
      }),
    ));

  it("turns a pending terminal response into an error", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(
          createHarness({
            responses: [{ text: "partial", stopReason: "pending" }],
            settings: { retry: { enabled: false } },
          }),
        );

        yield* awaited(harness.session.prompt("hi"));

        const assistantMessages = harness.session.messages.filter(
          (m): m is AssistantMessage => m.role === "assistant",
        );
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]?.stopReason).toBe("error");
        expect(assistantMessages[0]?.errorMessage).toBe(
          "Faux response ended without a stop reason",
        );
      }),
    ));

  it("retry on transient error", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(
          createHarness({
            responses: [{ error: "overloaded_error" }, "recovered"],
            settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
          }),
        );

        yield* awaited(harness.session.prompt("hi"));

        expect(harness.faux.callCount).toBe(2);

        const retryStarts = harness.eventsOfType("auto_retry_start");
        expect(retryStarts).toHaveLength(1);

        const retryEnds = harness.eventsOfType("auto_retry_end");
        expect(retryEnds).toHaveLength(1);
        expect(retryEnds[0]?.success).toBe(true);
      }),
    ));

  it("custom usage numbers", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(
          createHarness({
            responses: [{ text: "big response", usage: { input: 100000, output: 5000 } }],
          }),
        );

        yield* awaited(harness.session.prompt("hi"));

        const msg = harness.session.messages.find(
          (m): m is AssistantMessage => m.role === "assistant",
        )!;
        expect(msg.usage.input).toBe(100000);
        expect(msg.usage.output).toBe(5000);
      }),
    ));

  it("event capture", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(createHarness({ responses: ["hello"] }));

        yield* awaited(harness.session.prompt("hi"));

        const agentStarts = harness.eventsOfType("agent_start");
        expect(agentStarts).toHaveLength(1);

        const agentEnds = harness.eventsOfType("agent_end");
        expect(agentEnds).toHaveLength(1);

        const messageEnds = harness.eventsOfType("message_end");
        expect(messageEnds.length).toBeGreaterThanOrEqual(2);
      }),
    ));

  it("context capture", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(createHarness({ responses: ["reply"] }));

        yield* awaited(harness.session.prompt("my question"));

        expect(harness.faux.contexts).toHaveLength(1);
        const ctx = harness.faux.contexts[0];
        const userMsg = ctx?.messages.find((m) => m.role === "user");
        expect(userMsg).toBeDefined();
      }),
    ));

  it("wraps around when more calls than responses", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(createHarness({ responses: ["a", "b"] }));

        yield* awaited(harness.session.prompt("1"));
        yield* awaited(harness.session.prompt("2"));
        yield* awaited(harness.session.prompt("3"));

        expect(harness.faux.callCount).toBe(3);

        const texts = harness.session.messages
          .filter((m): m is AssistantMessage => m.role === "assistant")
          .map((m) => m.content.find((c) => c.type === "text")?.text);

        expect(texts).toEqual(["a", "b", "a"]);
      }),
    ));

  it("streams text deltas", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(createHarness({ responses: ["hello world"] }));

        yield* awaited(harness.session.prompt("hi"));

        const updates = harness.eventsOfType("message_update");
        const textDeltas = updates.filter((e) => e.assistantMessageEvent.type === "text_delta");
        expect(textDeltas.length).toBeGreaterThan(0);

        const reconstructed = textDeltas
          .map((e) => (e.assistantMessageEvent as { delta: string }).delta)
          .join("");
        expect(reconstructed).toBe("hello world");
      }),
    ));

  it("streams thinking deltas", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(
          createHarness({
            responses: [{ thinking: "let me think about this", text: "answer" }],
          }),
        );

        yield* awaited(harness.session.prompt("hi"));

        const updates = harness.eventsOfType("message_update");
        const thinkingStarts = updates.filter(
          (e) => e.assistantMessageEvent.type === "thinking_start",
        );
        const thinkingDeltas = updates.filter(
          (e) => e.assistantMessageEvent.type === "thinking_delta",
        );
        const thinkingEnds = updates.filter((e) => e.assistantMessageEvent.type === "thinking_end");

        expect(thinkingStarts).toHaveLength(1);
        expect(thinkingDeltas.length).toBeGreaterThan(0);
        expect(thinkingEnds).toHaveLength(1);

        const reconstructed = thinkingDeltas
          .map((e) => (e.assistantMessageEvent as { delta: string }).delta)
          .join("");
        expect(reconstructed).toBe("let me think about this");
      }),
    ));

  it("streams tool call deltas", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const echoTool: AgentTool = {
          name: "echo",
          label: "Echo",
          description: "Echo back",
          parameters: Type.Object({ text: Type.String() }),
          execute: () =>
            effectRunPromise(
              awaited({ content: [{ type: "text" as const, text: "echoed" }], details: {} }),
            ),
        };

        harness = yield* awaited(
          createHarness({
            responses: [{ toolCalls: [{ name: "echo", args: { text: "hi" } }] }, "done"],
            tools: [echoTool],
            baseToolsOverride: { echo: echoTool },
          }),
        );

        yield* awaited(harness.session.prompt("use tool"));

        const updates = harness.eventsOfType("message_update");
        const toolcallStarts = updates.filter(
          (e) => e.assistantMessageEvent.type === "toolcall_start",
        );
        const toolcallDeltas = updates.filter(
          (e) => e.assistantMessageEvent.type === "toolcall_delta",
        );
        const toolcallEnds = updates.filter((e) => e.assistantMessageEvent.type === "toolcall_end");

        expect(toolcallStarts).toHaveLength(1);
        expect(toolcallDeltas.length).toBeGreaterThan(0);
        expect(toolcallEnds).toHaveLength(1);
      }),
    ));

  it("streams thinking then text then tool call in order", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const echoTool: AgentTool = {
          name: "echo",
          label: "Echo",
          description: "Echo back",
          parameters: Type.Object({ text: Type.String() }),
          execute: () =>
            effectRunPromise(
              awaited({ content: [{ type: "text" as const, text: "echoed" }], details: {} }),
            ),
        };

        harness = yield* awaited(
          createHarness({
            responses: [
              {
                thinking: "hmm",
                text: "I will call a tool",
                toolCalls: [{ name: "echo", args: { text: "x" } }],
              },
              "final",
            ],
            tools: [echoTool],
            baseToolsOverride: { echo: echoTool },
          }),
        );

        yield* awaited(harness.session.prompt("do it"));

        const updates = harness.eventsOfType("message_update");
        const streamTypes = updates.map((e) => e.assistantMessageEvent.type);

        const firstThinking = streamTypes.indexOf("thinking_start");
        const firstText = streamTypes.indexOf("text_start");
        const firstToolcall = streamTypes.indexOf("toolcall_start");

        expect(firstThinking).toBeLessThan(firstText);
        expect(firstText).toBeLessThan(firstToolcall);
      }),
    ));

  it("loads inline extension factories and disambiguates duplicate commands", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const calls: string[] = [];

        harness = yield* awaited(
          createHarnessWithExtensions({
            extensionFactories: [
              {
                path: "<alpha>",
                factory: (msa) => {
                  msa.registerCommand("shared-cmd", {
                    description: "Alpha command",
                    handler: (args) =>
                      effectRunPromise(
                        Effect.sync(() => {
                          calls.push(`alpha:${args}`);
                        }),
                      ),
                  });
                },
              },
              {
                path: "<beta>",
                factory: (msa) => {
                  msa.registerCommand("shared-cmd", {
                    description: "Beta command",
                    handler: (args) =>
                      effectRunPromise(
                        Effect.sync(() => {
                          calls.push(`beta:${args}`);
                        }),
                      ),
                  });
                },
              },
            ],
          }),
        );

        const runner = harness.session.extensionRunner;
        expect(runner).toBeDefined();

        const commands = runner!.getRegisteredCommands();
        expect(
          commands.map((command) => ({
            name: command.name,
            invocationName: command.invocationName,
            description: command.description,
            path: command.sourceInfo.path,
          })),
        ).toEqual([
          {
            name: "shared-cmd",
            invocationName: "shared-cmd:1",
            description: "Alpha command",
            path: "<alpha>",
          },
          {
            name: "shared-cmd",
            invocationName: "shared-cmd:2",
            description: "Beta command",
            path: "<beta>",
          },
        ]);

        yield* awaited(
          runner!.getCommand("shared-cmd:1")?.handler("first", runner!.createCommandContext()),
        );
        yield* awaited(
          runner!.getCommand("shared-cmd:2")?.handler("second", runner!.createCommandContext()),
        );

        expect(calls).toEqual(["alpha:first", "beta:second"]);
      }),
    ));

  it("session persistence works", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(createHarness({ responses: ["persisted"] }));

        yield* awaited(harness.session.prompt("hi"));

        const entries = harness.sessionManager.getEntries();
        const messageEntries = entries.filter((e) => e.type === "message");
        expect(messageEntries.length).toBeGreaterThanOrEqual(2);
      }),
    ));
});
