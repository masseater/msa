import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { agentLoop } from "../src/agent-loop.ts";
import type { AgentEvent, AgentLoopConfig, AgentTool } from "../src/types.ts";
import fixtures from "./support/fixtures.ts";

const {
  collect,
  createModel,
  createUserMessage,
  delayed,
  echoResult,
  identityConverter,
  scripted,
  textMessage,
  tool,
  toolCallMessage,
  toolResultIds,
} = fixtures;

interface Race {
  firstResolved: boolean;
  parallelObserved: boolean;
}

const runRace = (race: Race, value: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      if (value === "first") {
        yield* Effect.sleep(20);
        race.firstResolved = true;
      }
      if (value === "second" && !race.firstResolved) race.parallelObserved = true;
      return echoResult(value);
    }),
  );

const racingTool = (race: Race, mode?: AgentTool["executionMode"]) =>
  tool({
    ...(mode === undefined ? {} : { executionMode: mode }),
    run: (_id, params) => runRace(race, params.value),
  });

const firstAndSecond = toolCallMessage([
  { args: { value: "first" }, id: "tool-1" },
  { args: { value: "second" }, id: "tool-2" },
]);

const runRacing = (echo: AgentTool<any>, config: Partial<AgentLoopConfig> = {}) =>
  collect(
    agentLoop(
      [createUserMessage("echo both")],
      { messages: [], tools: [echo] },
      { convertToLlm: identityConverter, model: createModel(), ...config },
      undefined,
      scripted(firstAndSecond, textMessage("done")).streamFn,
    ),
  );

const completionOrder = Effect.gen(function* () {
  const race: Race = { firstResolved: false, parallelObserved: false };
  const { events } = yield* runRacing(racingTool(race), { toolExecution: "parallel" });
  const ends = events.flatMap((event) =>
    event.type === "tool_execution_end" ? [event.toolCallId] : [],
  );
  const turnResults = events.flatMap((event) =>
    event.type === "turn_end" ? event.toolResults.map((result) => result.toolCallId) : [],
  );
  expect(race.parallelObserved).toBe(true);
  expect(ends).toEqual(["tool-2", "tool-1"]);
  expect(toolResultIds(events)).toEqual(["tool-1", "tool-2"]);
  expect(turnResults).toEqual(["tool-1", "tool-2"]);
});

const userTexts = (events: readonly AgentEvent[]): string[] =>
  events.flatMap((event) => {
    if (event.type !== "message_start") return [];
    if (event.message.role === "toolResult") return [`tool:${event.message.toolCallId}`];
    if (event.message.role === "user" && typeof event.message.content === "string") {
      return [event.message.content];
    }
    return [];
  });

const steeringAfterTools = Effect.gen(function* () {
  const executed: string[] = [];
  let queuedDelivered = false;
  const echo = tool({
    run: (_id, params) => {
      executed.push(params.value);
      return Promise.resolve(echoResult(params.value));
    },
  });
  const getSteeringMessages = () => {
    if (executed.length === 0 || queuedDelivered) return Promise.resolve([]);
    queuedDelivered = true;
    return Promise.resolve([createUserMessage("interrupt")]);
  };
  const script = scripted(firstAndSecond, textMessage("done"));
  const { events } = yield* collect(
    agentLoop(
      [createUserMessage("start")],
      { messages: [], tools: [echo] },
      {
        convertToLlm: identityConverter,
        getSteeringMessages,
        model: createModel(),
        toolExecution: "sequential",
      },
      undefined,
      script.streamFn,
    ),
  );
  expect(executed).toEqual(["first", "second"]);
  const toolEnds = events.filter((event) => event.type === "tool_execution_end");
  expect(toolEnds.map((event) => event.type === "tool_execution_end" && event.isError)).toEqual([
    false,
    false,
  ]);
  const sequence = userTexts(events);
  expect(sequence).toContain("interrupt");
  expect(sequence.indexOf("tool:tool-1")).toBeLessThan(sequence.indexOf("interrupt"));
  expect(sequence.indexOf("tool:tool-2")).toBeLessThan(sequence.indexOf("interrupt"));
  const second = script.contexts[1]?.messages ?? [];
  expect(second.some((message) => message.role === "user" && message.content === "interrupt")).toBe(
    true,
  );
});

const sequentialTool = Effect.gen(function* () {
  const race: Race = { firstResolved: false, parallelObserved: false };
  const { events } = yield* runRacing(racingTool(race, "sequential"));
  expect(race.parallelObserved).toBe(false);
  expect(toolResultIds(events)).toEqual(["tool-1", "tool-2"]);
});

const oneSequentialTool = Effect.gen(function* () {
  const executionOrder: string[] = [];
  const ordered = (name: string, mode: AgentTool["executionMode"]) =>
    tool({
      executionMode: mode,
      name,
      run: (_id, params) => {
        executionOrder.push(`${name}:${params.value}`);
        return params.value === "a"
          ? delayed(20)(echoResult(params.value))
          : Promise.resolve(echoResult(params.value));
      },
    });
  const script = scripted(
    toolCallMessage([
      { args: { value: "a" }, id: "tool-1", name: "slow" },
      { args: { value: "b" }, id: "tool-2", name: "fast" },
    ]),
    textMessage("done"),
  );
  yield* collect(
    agentLoop(
      [createUserMessage("run both")],
      { messages: [], tools: [ordered("slow", "sequential"), ordered("fast", "parallel")] },
      { convertToLlm: identityConverter, model: createModel() },
      undefined,
      script.streamFn,
    ),
  );
  expect(executionOrder[0]).toBe("slow:a");
  expect(executionOrder).toContain("fast:b");
});

const allParallelTools = Effect.gen(function* () {
  const race: Race = { firstResolved: false, parallelObserved: false };
  yield* runRacing(racingTool(race, "parallel"));
  expect(race.parallelObserved).toBe(true);
});

describe("agentLoop tool execution order", () => {
  it("should emit tool_execution_end in completion order but persist tool results in source order", () =>
    Effect.runPromise(completionOrder));
  it("should inject queued messages after all tool calls complete", () =>
    Effect.runPromise(steeringAfterTools));
  it("should force sequential execution when a tool has executionMode=sequential even with default parallel config", () =>
    Effect.runPromise(sequentialTool));
  it("should force sequential execution when one of multiple tools has executionMode=sequential", () =>
    Effect.runPromise(oneSequentialTool));
  it("should allow parallel execution when all tools have executionMode=parallel", () =>
    Effect.runPromise(allParallelTools));
});
