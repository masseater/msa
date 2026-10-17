import type { AgentTool } from "@msa/agent-core";
import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
  type TranscriptContext,
} from "@msa/ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { GOAL_ENTRY_TYPE, type GoalEntryData } from "../../src/core/goal.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, getUserTexts, type Harness } from "./harness.ts";

const touchTool: AgentTool = {
  name: "touch",
  label: "Touch",
  description: "Do some work",
  parameters: Type.Object({}),
  execute: async () => ({ content: [{ type: "text", text: "touched" }], details: {} }),
};

/** A working turn that calls a tool and then answers. */
function workTurn(text: string): AssistantMessage[] {
  return [
    fauxAssistantMessage(fauxToolCall("touch", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage(text),
  ];
}

function verdict(value: "not_met" | "met" | "impossible", reason: string) {
  return (context: TranscriptContext) => {
    if (!getCurrentSystemPrompt(context.messages).includes("completion condition")) {
      throw new Error("expected an evaluator request");
    }
    return fauxAssistantMessage(JSON.stringify({ verdict: value, reason }));
  };
}

function goalEvents(harness: Harness): GoalEntryData[] {
  return harness.sessionManager
    .getEntries()
    .flatMap((entry) =>
      entry.type === "custom" && entry.customType === GOAL_ENTRY_TYPE
        ? [entry.data as GoalEntryData]
        : [],
    );
}

describe("AgentSession /goal", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  async function setup(sessionManager?: SessionManager): Promise<Harness> {
    const harness = await createHarness({
      tools: [touchTool],
      ...(sessionManager ? { sessionManager } : {}),
    });
    harnesses.push(harness);
    return harness;
  }

  it("works from the condition alone and stops when the evaluator says it is met", async () => {
    const harness = await setup();
    harness.setResponses([
      ...workTurn("tried once"),
      verdict("not_met", "tests still fail"),
      ...workTurn("fixed"),
      verdict("met", "tests pass"),
    ]);

    await harness.session.prompt("/goal make the tests pass");

    expect(harness.getPendingResponseCount()).toBe(0);
    expect(getUserTexts(harness)).toEqual(["make the tests pass"]);
    expect(harness.session.goal).toBeUndefined();
    expect(goalEvents(harness).map((data) => data.event)).toEqual(["set", "evaluated", "met"]);
    expect(goalEvents(harness).at(-1)).toMatchObject({
      event: "met",
      turns: 2,
      reason: "tests pass",
    });
    const guidance = harness.session.messages.find(
      (message) => message.role === "custom" && message.customType === "msa.goal.continue",
    );
    expect(JSON.stringify(guidance)).toContain("tests still fail");
    expect(harness.session.isIdle).toBe(true);
  });

  it("ends the goal when the evaluator says it is impossible", async () => {
    const harness = await setup();
    harness.setResponses([...workTurn("blocked"), verdict("impossible", "needs a password")]);

    await harness.session.prompt("/goal deploy");

    expect(harness.session.goal).toBeUndefined();
    expect(goalEvents(harness).at(-1)).toMatchObject({
      event: "impossible",
      reason: "needs a password",
    });
  });

  it("hands control back after turns without tool calls and keeps the goal", async () => {
    const harness = await setup();
    harness.setResponses([
      fauxAssistantMessage("thinking"),
      verdict("not_met", "nothing done"),
      fauxAssistantMessage("still thinking"),
      verdict("not_met", "nothing done"),
      fauxAssistantMessage("more thinking"),
      verdict("not_met", "nothing done"),
    ]);

    await harness.session.prompt("/goal ship it");

    expect(harness.getPendingResponseCount()).toBe(0);
    expect(harness.session.goal?.condition).toBe("ship it");
    expect(harness.session.goal?.turns).toBe(3);
    expect(goalEvents(harness).at(-1)?.event).toBe("paused");

    // The next prompt resumes evaluation.
    harness.setResponses([...workTurn("done"), verdict("met", "shipped")]);
    await harness.session.prompt("go on");
    expect(harness.session.goal).toBeUndefined();
  });

  it("shows status and clears with /goal clear or an alias", async () => {
    const harness = await setup();
    harness.session.setGoal("first");
    await harness.session.prompt("/goal");
    expect(harness.eventsOfType("goal_status").at(-1)?.goal?.condition).toBe("first");

    await harness.session.prompt("/goal stop");
    expect(harness.session.goal).toBeUndefined();
    expect(goalEvents(harness).map((data) => data.event)).toEqual(["set", "cleared"]);

    await harness.session.prompt("/goal clear");
    expect(harness.eventsOfType("goal_status").at(-1)?.goal).toBeUndefined();
  });

  it("replaces an active goal with a new one", async () => {
    const harness = await setup();
    harness.session.setGoal("first");
    harness.session.setGoal("second");
    expect(harness.session.goal?.condition).toBe("second");
  });

  it("rejects conditions over 4000 characters", async () => {
    const harness = await setup();
    await expect(harness.session.prompt(`/goal ${"x".repeat(4001)}`)).rejects.toThrow("4000");
    expect(harness.session.goal).toBeUndefined();
  });

  it("clears the goal on an authentication failure", async () => {
    const harness = await setup();
    harness.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 Unauthorized" }),
    ]);

    await harness.session.prompt("/goal anything");

    expect(harness.session.goal).toBeUndefined();
    expect(goalEvents(harness).at(-1)).toMatchObject({
      event: "failed",
      reason: "401 Unauthorized",
    });
  });

  it("retries other errors and pauses with the goal kept when they repeat", async () => {
    const harness = await createHarness({
      tools: [touchTool],
      settings: { retry: { enabled: false } },
    });
    harnesses.push(harness);
    const failure = () =>
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "socket hang up" });
    harness.setResponses([failure(), failure(), failure()]);

    await harness.session.prompt("/goal anything");

    expect(harness.getPendingResponseCount()).toBe(0);
    expect(harness.session.goal?.condition).toBe("anything");
    expect(goalEvents(harness).at(-1)?.event).toBe("paused");
  });

  it("waits out a rate limit, and an abort during the wait keeps the goal", async () => {
    const harness = await createHarness({
      tools: [touchTool],
      settings: { retry: { enabled: false } },
    });
    harnesses.push(harness);
    harness.session.subscribe((event) => {
      if (
        event.type === "entry_appended" &&
        event.entry.type === "custom" &&
        (event.entry.data as GoalEntryData).event === "waiting"
      ) {
        void harness.session.abort();
      }
    });
    harness.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 Too Many Requests" }),
    ]);

    await harness.session.prompt("/goal anything");

    expect(goalEvents(harness).at(-1)).toMatchObject({ event: "waiting", delayMs: 60_000 });
    expect(harness.session.goal?.condition).toBe("anything");
    expect(harness.session.isIdle).toBe(true);
  });

  it("restores an unfinished goal when the session is resumed, but not a finished one", async () => {
    const unfinished = SessionManager.inMemory();
    unfinished.appendCustomEntry(GOAL_ENTRY_TYPE, { event: "set", condition: "keep going" });
    expect((await setup(unfinished)).session.goal).toMatchObject({
      condition: "keep going",
      turns: 0,
    });

    const finished = SessionManager.inMemory();
    finished.appendCustomEntry(GOAL_ENTRY_TYPE, { event: "set", condition: "done" });
    finished.appendCustomEntry(GOAL_ENTRY_TYPE, {
      event: "met",
      condition: "done",
      reason: "ok",
      turns: 1,
      elapsedMs: 1,
      tokens: 1,
    });
    expect((await setup(finished)).session.goal).toBeUndefined();
  });

  it("stops the loop when the run is aborted", async () => {
    const harness = await setup();
    harness.setResponses([
      ...workTurn("working"),
      async () => {
        void harness.session.abort();
        return fauxAssistantMessage("", { stopReason: "aborted" });
      },
    ]);

    await harness.session.prompt("/goal long task");

    expect(harness.session.goal?.condition).toBe("long task");
    expect(harness.session.isIdle).toBe(true);
  });
});
