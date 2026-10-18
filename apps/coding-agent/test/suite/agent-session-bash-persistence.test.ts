import { Buffer } from "node:buffer";

import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { BashOperations } from "../../src/core/tools/bash.ts";
import { createHarness, type Harness } from "./harness.ts";

function getEntryTypes(harness: Harness): string[] {
  return harness.sessionManager.getEntries().map((entry) => entry.type);
}

interface ControlledBashInvocation {
  signal: AbortSignal | undefined;
  finish: () => void;
}

function createControlledBashOperations(invocations: ControlledBashInvocation[]): BashOperations {
  return {
    exec: (_command, _cwd, options) =>
      new Promise<{ exitCode: number | null }>((resolve) => {
        invocations.push({
          signal: options.signal,
          finish: () => resolve({ exitCode: 0 }),
        });
      }),
  };
}

const harnesses: Harness[] = [];

const recordsBashResultsImmediatelyWhileIdle = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.session.recordBashResult("echo hi", {
    output: "hi",
    exitCode: 0,
    cancelled: false,
    truncated: false,
  });

  expect(harness.session.hasPendingBashMessages).toBe(false);
  expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("bashExecution");
  expect(getEntryTypes(harness)).toContain("message");
});

const defersBashResultsWhileStreamingAnd = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRelease = gate();
  const waitTool: AgentTool = {
    name: "wait",
    label: "Wait",
    description: "Wait for release",
    parameters: Type.Object({}),
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => toolRelease);
          return {
            content: [{ type: "text", text: "released" }],
            details: {},
          };
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [waitTool] }));
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("after flush"),
  ]);

  const sawToolStart = new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        unsubscribe();
        resolve();
      }
    });
  });

  const firstPrompt = harness.session.prompt("start");
  yield* Effect.promise(() => sawToolStart);
  harness.session.recordBashResult("echo hi", {
    output: "hi",
    exitCode: 0,
    cancelled: false,
    truncated: false,
  });

  expect(harness.session.hasPendingBashMessages).toBe(true);
  expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(false);

  toolRelease.release();
  yield* Effect.promise(() => firstPrompt);

  expect(harness.session.hasPendingBashMessages).toBe(false);
  expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(true);

  yield* Effect.promise(() => harness.session.prompt("next turn"));

  expect(harness.session.hasPendingBashMessages).toBe(false);
  expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(true);
  expect(getEntryTypes(harness).filter((type) => type === "message").length).toBeGreaterThan(0);
});

const executesBashCommandsAndRecordsThe = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  const result = yield* Effect.promise(() => harness.session.executeBash("printf 'hello'"));

  expect(result.output).toContain("hello");
  expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("bashExecution");
});

const cancelsRunningBashCommandsWithAbortbash = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const operations: BashOperations = {
    exec: (_command, _cwd, options) =>
      new Promise<{ exitCode: number | null }>((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => {
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
  };

  const bashPromise = harness.session.executeBash("sleep", undefined, { operations });
  yield* Effect.sleep(0);
  expect(harness.session.isBashRunning).toBe(true);
  harness.session.abortBash();

  const result = yield* Effect.promise(() => bashPromise);
  expect(result.cancelled).toBe(true);
  expect(harness.session.isBashRunning).toBe(false);
});

const keepsNewerBashExecutionTrackedWhen = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const invocations: ControlledBashInvocation[] = [];
  const operations = createControlledBashOperations(invocations);

  const firstBash = harness.session.executeBash("first", undefined, { operations });
  const secondBash = harness.session.executeBash("second", undefined, { operations });

  const firstInvocation = invocations[0];
  if (firstInvocation === undefined) throw new Error("expected the first bash invocation");
  firstInvocation.finish();
  const firstResult = yield* Effect.promise(() => firstBash);
  const runningAfterFirstSettles = harness.session.isBashRunning;

  harness.session.abortBash();
  const secondInvocation = invocations[1];
  if (secondInvocation === undefined) throw new Error("expected the second bash invocation");
  const secondWasAborted = secondInvocation.signal?.aborted;
  secondInvocation.finish();
  const secondResult = yield* Effect.promise(() => secondBash);

  expect(firstResult.cancelled).toBe(false);
  expect(runningAfterFirstSettles).toBe(true);
  expect(secondWasAborted).toBe(true);
  expect(secondResult.cancelled).toBe(true);
  expect(harness.session.isBashRunning).toBe(false);
});

const abortsAllActiveBashExecutions = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const invocations: ControlledBashInvocation[] = [];
  const operations = createControlledBashOperations(invocations);

  const firstBash = harness.session.executeBash("first", undefined, { operations });
  const secondBash = harness.session.executeBash("second", undefined, { operations });

  harness.session.abortBash();
  const abortedSignals = invocations.map((invocation) => invocation.signal?.aborted);
  for (const invocation of invocations) {
    invocation.finish();
  }
  const results = yield* Effect.promise(() => Promise.all([firstBash, secondBash]));

  expect(abortedSignals).toEqual([true, true]);
  expect(results.map((result) => result.cancelled)).toEqual([true, true]);
  expect(harness.session.isBashRunning).toBe(false);
});

const persistsUserAssistantToolresultAndCustom = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const echoTool: AgentTool = {
    name: "echo",
    label: "Echo",
    description: "Echo text back",
    parameters: Type.Object({ text: Type.String() }),
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          return { content: [{ type: "text", text: `echo:${text}` }], details: { text } };
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [echoTool] }));
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  return yield* persistsUserAssistantToolresultAndCustomPart2(harness);
});

const persistsUserAssistantToolresultAndCustomPart2 = (harness: Harness) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      harness.session.sendCustomMessage({
        customType: "note",
        content: "hello",
        display: true,
        details: { a: 1 },
      }),
    );
    yield* Effect.promise(() => harness.session.prompt("start"));
    const entries = harness.sessionManager.getEntries();
    expect(entries.map((entry) => entry.type)).toEqual([
      "custom_message",
      "message",
      "message",
      "message",
      "message",
      "message",
    ]);
    expect(harness.session.messages.map((message) => message.role)).toEqual([
      "custom",
      "system",
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
  });

const doesNotEmitMessageEndFor = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const messageEndRoles: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "message_end") {
      messageEndRoles.push(event.message.role);
    }
  });

  harness.session.recordBashResult("echo hi", {
    output: "hi",
    exitCode: 0,
    cancelled: false,
    truncated: false,
  });

  expect(messageEndRoles).toEqual([]);
});

const persistsAbortedAssistantMessages = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("x".repeat(20_000))]);

  const sawMessageUpdate = new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "message_update") {
        unsubscribe();
        resolve();
      }
    });
  });

  const promptPromise = harness.session.prompt("hi");
  yield* Effect.promise(() => sawMessageUpdate);
  yield* Effect.promise(() => harness.session.abort());
  yield* Effect.promise(() => promptPromise);

  const lastEntry =
    harness.sessionManager.getEntries()[harness.sessionManager.getEntries().length - 1];
  expect(lastEntry?.type).toBe("message");
  if (lastEntry?.type === "message") {
    expect(lastEntry.message.role).toBe("assistant");
    if (lastEntry.message.role === "assistant") {
      expect(lastEntry.message.stopReason).toBe("aborted");
    }
  }
});

const recordsBashOutputThroughCustomOperations = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const operations: BashOperations = {
    exec: (_command, _cwd, options) =>
      runPromise(
        Effect.sync(() => {
          options.onData(Buffer.from("hello from custom ops"));
          return { exitCode: 0 };
        }),
      ),
  };

  const result = yield* Effect.promise(() =>
    harness.session.executeBash("custom", undefined, { operations }),
  );

  expect(result.output).toContain("hello from custom ops");
  expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("bashExecution");
});

const streamsBashOutputToTheCallback = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const callbackDeltas: string[] = [];
  const eventUpdates: Array<{ id: string | undefined; delta: string }> = [];
  const unsubscribe = harness.session.subscribe((event) => {
    if (event.type === "bash_execution_update") {
      eventUpdates.push({ id: event.id, delta: event.delta });
    }
  });
  const operations: BashOperations = {
    exec: (_command, _cwd, options) =>
      runPromise(
        Effect.sync(() => {
          options.onData(Buffer.from("hello "));
          options.onData(Buffer.from("world"));
          return { exitCode: 0 };
        }),
      ),
  };

  yield* Effect.promise(() =>
    harness.session.executeBash("custom", (delta) => callbackDeltas.push(delta), {
      id: "bash-1",
      operations,
    }),
  );
  unsubscribe();

  expect(callbackDeltas).toEqual(["hello ", "world"]);
  expect(eventUpdates).toEqual([
    { id: "bash-1", delta: "hello " },
    { id: "bash-1", delta: "world" },
  ]);
});

function runChunks(chunks: Array<string | Buffer>, beforeExit?: (streamed: string) => void) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const harness = yield* Effect.promise(() => createHarness());
      harnesses.push(harness);
      const deltas: string[] = [];
      const operations: BashOperations = {
        exec: (_command, _cwd, options) =>
          runPromise(
            Effect.sync(() => {
              for (const chunk of chunks) {
                options.onData(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
              }
              beforeExit?.(deltas.join(""));
              return { exitCode: 0 };
            }),
          ),
      };
      const result = yield* Effect.promise(() =>
        harness.session.executeBash("custom", (delta) => deltas.push(delta), {
          operations,
        }),
      );
      const recorded = harness.session.messages[harness.session.messages.length - 1];
      return {
        output: result.output,
        streamed: deltas.join(""),
        recorded: recorded?.role === "bashExecution" ? recorded.output : undefined,
      };
    }),
  );
}

const stripsAColorResetSplitInside = Effect.gen(function* () {
  const { output, streamed, recorded } = yield* Effect.promise(() =>
    runChunks(["\x1b[31mERROR: file.py:1\x1b[0", "m\n"]),
  );
  expect(output).toBe("ERROR: file.py:1\n");
  expect(streamed).toBe("ERROR: file.py:1\n");
  expect(recorded).toBe("ERROR: file.py:1\n");
});

const stripsAColorCodeSplitRight = Effect.gen(function* () {
  const { output, streamed } = yield* Effect.promise(() =>
    runChunks(["before\x1b", "[32mafter\n"]),
  );
  expect(output).toBe("beforeafter\n");
  expect(streamed).toBe("beforeafter\n");
});

const stripsAnOscSequenceSplitBefore = Effect.gen(function* () {
  const { output } = yield* Effect.promise(() =>
    runChunks(["a\x1b]0;window ", "title\x1b", "\\b\n"]),
  );
  expect(output).toBe("ab\n");
});

const flushesAnIncompleteMultiByteCharacter = Effect.gen(function* () {
  const { output, streamed } = yield* Effect.promise(() =>
    runChunks(["ok", Buffer.from("\u00e9").subarray(0, 1)]),
  );
  expect(output).toBe("ok\uFFFD");
  expect(streamed).toBe("ok\uFFFD");
});

const doesNotHoldBackOutputBehind = Effect.gen(function* () {
  const long = "x".repeat(300);
  let streamedBeforeExit = "";
  yield* Effect.promise(() =>
    runChunks([`\x1b]${long}`], (streamed) => {
      streamedBeforeExit = streamed;
    }),
  );
  expect(streamedBeforeExit).toBe(`]${long}`);
});

describe("AgentSession bash and persistence characterization", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("records bash results immediately while idle", () =>
    Effect.runPromise(recordsBashResultsImmediatelyWhileIdle));
  it("defers bash results while streaming and flushes them before the next prompt", () =>
    Effect.runPromise(defersBashResultsWhileStreamingAnd));
  it("executes bash commands and records the result", () =>
    Effect.runPromise(executesBashCommandsAndRecordsThe));
  it("cancels running bash commands with abortBash", () =>
    Effect.runPromise(cancelsRunningBashCommandsWithAbortbash));
  it("keeps newer bash execution tracked when an older execution finishes", () =>
    Effect.runPromise(keepsNewerBashExecutionTrackedWhen));
  it("aborts all active bash executions", () => Effect.runPromise(abortsAllActiveBashExecutions));
  it("persists user, assistant, toolResult, and custom messages in order", () =>
    Effect.runPromise(persistsUserAssistantToolresultAndCustom));
  it("does not emit message_end for bash execution messages", () =>
    Effect.runPromise(doesNotEmitMessageEndFor));
  it("persists aborted assistant messages", () =>
    Effect.runPromise(persistsAbortedAssistantMessages));
  it("records bash output through custom operations", () =>
    Effect.runPromise(recordsBashOutputThroughCustomOperations));
  it("streams bash output to the callback and session events", () =>
    Effect.runPromise(streamsBashOutputToTheCallback));
  describe("escape sequences split across output chunks", () => {
    it("strips a color reset split inside its parameters", () =>
      Effect.runPromise(stripsAColorResetSplitInside));
    it("strips a color code split right after ESC", () =>
      Effect.runPromise(stripsAColorCodeSplitRight));
    it("strips an OSC sequence split before its terminator", () =>
      Effect.runPromise(stripsAnOscSequenceSplitBefore));
    it("flushes an incomplete multi-byte character at the end of output", () =>
      Effect.runPromise(flushesAnIncompleteMultiByteCharacter));
    it("does not hold back output behind a long unterminated sequence", () =>
      Effect.runPromise(doesNotHoldBackOutputBehind));
  });
});
