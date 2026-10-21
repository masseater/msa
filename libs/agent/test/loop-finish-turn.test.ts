import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import agentLoopModule from "../src/agent-loop.ts";
import type typesModule from "../src/types.ts";
import fixtures from "./support/fixtures.ts";

const { agentLoop, runAgentLoop } = agentLoopModule;

const {
  createAssistantMessage,
  createModel,
  createUserMessage,
  echoResult,
  identityConverter,
  scripted,
  stoppedWith,
  textMessage,
  tool,
  toolCallMessage,
} = fixtures;

const noop = tool({
  name: "noop",
  parameters: Type.Object({}),
  run: () => Promise.resolve({ content: [{ text: "done", type: "text" }], details: undefined }),
});

const finishesBeforeTurnEnd = Effect.gen(function* () {
  const echo = tool({
    run: (_id, params) => Promise.resolve({ ...echoResult(params.value), terminate: true }),
  });
  const ordering: string[] = [];
  const config: typesModule.AgentLoopConfig = {
    convertToLlm: identityConverter,
    finishTurn: ({ context, toolResults }) => {
      ordering.push("finishTurn");
      expect(toolResults).toHaveLength(1);
      expect(context.messages.at(-1)?.role).toBe("toolResult");
    },
    model: createModel(),
  };
  yield* Effect.promise(() =>
    runAgentLoop(
      [createUserMessage("echo")],
      { messages: [], tools: [echo] },
      config,
      (event) => {
        if (event.type === "message_end") ordering.push(`message_end:${event.message.role}`);
        if (event.type === "turn_end") ordering.push("turn_end");
      },
      undefined,
      scripted(toolCallMessage([{ args: { value: "hello" }, id: "tool-1" }])).streamFn,
    ),
  );
  expect(ordering.slice(-3)).toEqual(["message_end:toolResult", "finishTurn", "turn_end"]);
});

const counters = () => ({ followUps: 0, prepared: 0, steering: 0 });

const hardExit = (reason: "error" | "aborted") =>
  Effect.gen(function* () {
    const ordering: string[] = [];
    const polls = counters();
    const script = scripted({
      ...stoppedWith(reason)(createAssistantMessage([])),
      errorMessage: reason,
    });
    const config: typesModule.AgentLoopConfig = {
      convertToLlm: identityConverter,
      finishTurn: ({ message }) => {
        expect(message.stopReason).toBe(reason);
        ordering.push("finishTurn");
        return { action: "continue" };
      },
      getFollowUpMessages: () =>
        Promise.resolve((polls.followUps++, [createUserMessage("queued")])),
      getSteeringMessages: () => Promise.resolve((polls.steering++, [])),
      model: createModel(),
    };
    const sink = (event: { type: string }) => {
      if (event.type === "turn_end") ordering.push("turn_end");
    };
    yield* Effect.promise(() =>
      runAgentLoop(
        [createUserMessage("run")],
        { messages: [], tools: [] },
        config,
        sink,
        undefined,
        script.streamFn,
      ),
    );
    expect(ordering).toEqual(["finishTurn", "turn_end"]);
    expect(script.calls()).toBe(1);
    expect(polls).toMatchObject({ followUps: 0, steering: 1 });
  });

const endSkipsPolling = Effect.gen(function* () {
  const polls = counters();
  const config: typesModule.AgentLoopConfig = {
    convertToLlm: identityConverter,
    finishTurn: () => ({ action: "end" }),
    getFollowUpMessages: () => Promise.resolve((polls.followUps++, [createUserMessage("queued")])),
    getSteeringMessages: () => Promise.resolve((polls.steering++, [])),
    model: createModel(),
    prepareNextTurn: () => {
      polls.prepared++;
      return undefined;
    },
  };
  const script = scripted(toolCallMessage([{ id: "tool-1", name: "noop" }]));
  const stream = agentLoop(
    [createUserMessage("run")],
    { messages: [], tools: [noop] },
    config,
    undefined,
    script.streamFn,
  );
  yield* Effect.promise(() => stream.result());
  expect(script.calls()).toBe(1);
  expect(polls).toEqual({ followUps: 0, prepared: 0, steering: 1 });
});

const continueOnce = () => {
  let finishCalls = 0;
  return {
    finishCalls: () => finishCalls,
    finishTurn: () => {
      finishCalls++;
      return finishCalls === 1 ? ({ action: "continue" } as const) : undefined;
    },
  };
};

const contextOnlyRequest = Effect.gen(function* () {
  const finish = continueOnce();
  const script = scripted(textMessage("response 1"), textMessage("response 2"));
  const stream = agentLoop(
    [createUserMessage("run")],
    { messages: [], tools: [] },
    { convertToLlm: identityConverter, finishTurn: finish.finishTurn, model: createModel() },
    undefined,
    script.streamFn,
  );
  yield* Effect.promise(() => stream.result());
  expect(script.calls()).toBe(2);
  expect(finish.finishCalls()).toBe(2);
});

const toolResultSatisfies = Effect.gen(function* () {
  const finish = continueOnce();
  const script = scripted(toolCallMessage([{ id: "tool-1", name: "noop" }]), textMessage("done"));
  const stream = agentLoop(
    [createUserMessage("run")],
    { messages: [], tools: [noop] },
    { convertToLlm: identityConverter, finishTurn: finish.finishTurn, model: createModel() },
    undefined,
    script.streamFn,
  );
  yield* Effect.promise(() => stream.result());
  expect(script.calls()).toBe(2);
  expect(finish.finishCalls()).toBe(2);
});

const queueSatisfies = (queueKind: "steering" | "follow-up") =>
  Effect.gen(function* () {
    const queuedMessage = createUserMessage(queueKind);
    const finish = continueOnce();
    let steeringPolls = 0;
    let followUpDelivered = false;
    const config: typesModule.AgentLoopConfig = {
      convertToLlm: identityConverter,
      finishTurn: finish.finishTurn,
      getFollowUpMessages: () => {
        if (queueKind !== "follow-up" || followUpDelivered) return Promise.resolve([]);
        followUpDelivered = true;
        return Promise.resolve([queuedMessage]);
      },
      getSteeringMessages: () => {
        steeringPolls++;
        return Promise.resolve(
          queueKind === "steering" && steeringPolls === 2 ? [queuedMessage] : [],
        );
      },
      model: createModel(),
    };
    const script = scripted(textMessage("done"));
    const stream = agentLoop(
      [createUserMessage("run")],
      { messages: [], tools: [] },
      config,
      undefined,
      script.streamFn,
    );
    yield* Effect.promise(() => stream.result());
    const secondUsers = (script.contexts[1]?.messages ?? []).flatMap((message) =>
      message.role === "user" && typeof message.content === "string" ? [message.content] : [],
    );
    expect(script.calls()).toBe(2);
    expect(finish.finishCalls()).toBe(2);
    expect(secondUsers).toContain(queueKind);
  });

describe("agentLoop finishTurn", () => {
  it("runs finishTurn after tool-result messages and before turn_end", () =>
    Effect.runPromise(finishesBeforeTurnEnd));
  it.each(["error", "aborted"] as const)(
    "runs finishTurn for a %s assistant before turn_end without changing the hard exit",
    (reason) => Effect.runPromise(hardExit(reason)),
  );
  it("action:end skips queue polling and next-turn preparation", () =>
    Effect.runPromise(endSkipsPolling));
  it("makes exactly one context-only request when no natural request satisfies continuation", () =>
    Effect.runPromise(contextOnlyRequest));
  it("lets a natural tool-result request satisfy continuation", () =>
    Effect.runPromise(toolResultSatisfies));
  it.each(["steering", "follow-up"] as const)(
    "lets a natural %s request satisfy continuation",
    (queueKind) => Effect.runPromise(queueSatisfies(queueKind)),
  );
});
