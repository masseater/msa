import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import agentLoopModule from "../src/agent-loop.ts";
import type typesModule from "../src/types.ts";
import fixtures from "./support/fixtures.ts";
import type fixturesTypes from "./support/fixtures.types.ts";

const { agentLoop } = agentLoopModule;

const {
  collect,
  createModel,
  createUserMessage,
  echoResult,
  identityConverter,
  scripted,
  textMessage,
  tool,
  toolCallMessage,
} = fixtures;

const helloCall = toolCallMessage([{ args: { value: "hello" }, id: "tool-1" }]);

const bothCalls = toolCallMessage([
  { args: { value: "first" }, id: "tool-1" },
  { args: { value: "second" }, id: "tool-2" },
]);

const run = (
  echo: typesModule.AgentTool<any>,
  script: fixturesTypes.Script,
  config: Partial<typesModule.AgentLoopConfig> = {},
) =>
  collect(
    agentLoop(
      [createUserMessage("echo something")],
      { messages: [], tools: [echo] },
      { convertToLlm: identityConverter, model: createModel(), ...config },
      undefined,
      script.streamFn,
    ),
  );

const roles = (messages: readonly { role: string }[]) => messages.map((message) => message.role);

const allTerminate = Effect.gen(function* () {
  const echo = tool({
    run: (_id, params) => Promise.resolve({ ...echoResult(params.value), terminate: true }),
  });
  const script = scripted(helloCall);
  const { events, messages } = yield* run(echo, script);
  expect(script.calls()).toBe(1);
  expect(roles(messages)).toEqual(["system", "user", "assistant", "toolResult"]);
  expect(events.filter((event) => event.type === "turn_end")).toHaveLength(1);
});

const blockedTerminates = Effect.gen(function* () {
  let executed = false;
  const echo = tool({
    run: () => {
      executed = true;
      return Promise.resolve(echoResult("unexpected"));
    },
  });
  const script = scripted(helloCall, textMessage("should not run"));
  const { messages } = yield* run(echo, script, {
    beforeToolCall: () =>
      Promise.resolve({ block: true, reason: "Blocked by policy", terminate: true }),
  });
  const toolResult = messages.find((message) => message.role === "toolResult");
  expect(executed).toBe(false);
  expect(script.calls()).toBe(1);
  expect(toolResult?.role === "toolResult" ? toolResult.isError : false).toBe(true);
  expect(toolResult?.role === "toolResult" ? toolResult.content : []).toContainEqual({
    text: "Blocked by policy",
    type: "text",
  });
});

const mixedBatchContinues = Effect.gen(function* () {
  const executed: string[] = [];
  const echo = tool({
    run: (_id, params) => {
      executed.push(params.value);
      return Promise.resolve(echoResult(params.value));
    },
  });
  const script = scripted(bothCalls, textMessage("done"));
  yield* run(echo, script, {
    beforeToolCall: ({ args }) =>
      Promise.resolve(
        (args as { value: string }).value === "first"
          ? { block: true, reason: "Blocked first", terminate: true }
          : undefined,
      ),
    toolExecution: "parallel",
  });
  expect(executed).toEqual(["second"]);
  expect(script.calls()).toBe(2);
});

const partialTerminateContinues = Effect.gen(function* () {
  const echo = tool({
    run: (_id, params) =>
      Promise.resolve({ ...echoResult(params.value), terminate: params.value === "first" }),
  });
  const script = scripted(bothCalls, textMessage("done"));
  const { messages } = yield* run(echo, script, { toolExecution: "parallel" });
  expect(script.calls()).toBe(2);
  expect(roles(messages)).toEqual([
    "system",
    "user",
    "assistant",
    "toolResult",
    "toolResult",
    "assistant",
  ]);
});

const afterHookTerminates = Effect.gen(function* () {
  const echo = tool({ run: (_id, params) => Promise.resolve(echoResult(params.value)) });
  const script = scripted(helloCall);
  yield* run(echo, script, { afterToolCall: () => Promise.resolve({ terminate: true }) });
  expect(script.calls()).toBe(1);
});

describe("agentLoop early termination", () => {
  it("should stop after a tool batch when every tool result sets terminate=true", () =>
    Effect.runPromise(allTerminate));
  it("should stop after a blocked tool call when beforeToolCall sets terminate=true", () =>
    Effect.runPromise(blockedTerminates));
  it("should continue after a mixed batch with one terminating blocked call", () =>
    Effect.runPromise(mixedBatchContinues));
  it("should continue after parallel tool calls when not all tool results terminate", () =>
    Effect.runPromise(partialTerminateContinues));
  it("should allow afterToolCall to mark a tool batch as terminating", () =>
    Effect.runPromise(afterHookTerminates));
});
