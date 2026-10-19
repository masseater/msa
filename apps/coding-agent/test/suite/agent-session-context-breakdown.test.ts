import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall } from "@msa/ai/compat";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { apportion, measureContextBreakdown } from "../../src/core/context-breakdown.ts";
import { convertToLlm } from "../../src/core/messages.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

describe("AgentSession.getContextBreakdown", () => {
  it("counts the system prompt and tool declarations the first request will carry", async () => {
    const harness = await createHarness();
    harnesses.push(harness);

    const breakdown = await harness.session.getContextBreakdown();

    const parts = new Set(breakdown.entries.map((entry) => entry.part));
    expect([...parts].sort()).toEqual(["system", "tools"]);
    expect(breakdown.entries.filter((entry) => entry.part === "tools").length).toBe(
      harness.session.getActiveToolNames().length,
    );
    expect(breakdown.tokens).toBeGreaterThan(0);
    expect(breakdown.entries.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(breakdown.tokens);
  });

  it("splits the next request into prompt sections, tools, and messages that sum to the context usage", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    writeFileSync(join(harness.tempDir, "a.txt"), "alpha ".repeat(400));
    writeFileSync(join(harness.tempDir, "b.txt"), "beta ".repeat(40));
    harness.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("read", { path: join(harness.tempDir, "a.txt") }),
          fauxToolCall("read", { path: join(harness.tempDir, "b.txt") }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    await harness.session.prompt("read both files");

    const breakdown = await harness.session.getContextBreakdown();

    expect(breakdown.method).toBe("estimated");
    expect(breakdown.tokens).toBe(harness.session.getContextUsage()?.tokens);
    expect(breakdown.entries.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(breakdown.tokens);

    const names = (part: string) =>
      breakdown.entries.filter((entry) => entry.part === part).map((entry) => entry.name);
    expect(names("system")).toEqual(expect.arrayContaining(["preamble", "tools", "rules", "cwd"]));
    expect(names("tools").sort()).toEqual([...harness.session.getActiveToolNames()].sort());
    expect(names("conversation").sort()).toEqual(["assistant", "user"]);
    expect(names("toolResults").sort()).toEqual(["bash", "read"]);
    expect(names("system")).not.toContain("updates");

    const read = breakdown.entries.find((e) => e.part === "toolResults" && e.name === "read");
    const bash = breakdown.entries.find((e) => e.part === "toolResults" && e.name === "bash");
    expect(read!.tokens).toBeGreaterThan(bash!.tokens);
  });
});

describe("apportion", () => {
  it("scales estimates to the total and hands the rounding leftovers to the largest remainders", () => {
    const entries = apportion(
      [
        { part: "system", name: "a", estimate: 1 },
        { part: "system", name: "b", estimate: 1 },
        { part: "system", name: "c", estimate: 1 },
      ],
      10,
    );
    expect(entries.map((entry) => entry.tokens)).toEqual([4, 3, 3]);

    const scaled = apportion(
      [
        { part: "tools", name: "x", estimate: 300 },
        { part: "conversation", name: "y", estimate: 100 },
      ],
      1000,
    );
    expect(scaled.map((entry) => entry.tokens)).toEqual([750, 250]);
  });
});

describe("measureContextBreakdown", () => {
  it("takes the provider count as an exact total", async () => {
    const breakdown = await Effect.runPromise(
      measureContextBreakdown({
        messages: [
          { role: "system", content: "", sections: { preamble: "You help." }, timestamp: 0 },
          { role: "user", content: "hello there", timestamp: 1 },
        ],
        pending: [],
        transformContext: undefined,
        convertToLlm,
        countTokens: async () => 123,
        usageTokens: 50,
        addingProvider: undefined,
      }),
    );
    expect(breakdown.method).toBe("exact");
    expect(breakdown.tokens).toBe(123);
    expect(breakdown.entries.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(123);
    expect(breakdown.entries.map((entry) => `${entry.part}/${entry.name}`)).toEqual([
      "system/preamble",
      "conversation/user",
    ]);
  });

  it("keeps msa's elements at their estimates and shows what another agent's provider added", async () => {
    const breakdown = await Effect.runPromise(
      measureContextBreakdown({
        messages: [{ role: "user", content: "x".repeat(400), timestamp: 1 }],
        pending: [],
        transformContext: undefined,
        convertToLlm,
        countTokens: async () => undefined,
        usageTokens: 5_000,
        addingProvider: "claude-subs-main",
      }),
    );
    expect(breakdown).toEqual({
      method: "estimated",
      tokens: 5_000,
      entries: [
        { part: "conversation", name: "user", tokens: 100 },
        { part: "other", name: "claude-subs-main", tokens: 4_900 },
      ],
    });
  });

  it("falls back to the context usage when the provider cannot count", async () => {
    const breakdown = await Effect.runPromise(
      measureContextBreakdown({
        messages: [{ role: "user", content: "hello there", timestamp: 1 }],
        pending: [],
        transformContext: undefined,
        convertToLlm,
        countTokens: async () => {
          throw new Error("count_tokens rejected");
        },
        usageTokens: 50,
        addingProvider: undefined,
      }),
    );
    expect(breakdown).toEqual({
      method: "estimated",
      tokens: 50,
      entries: [{ part: "conversation", name: "user", tokens: 50 }],
    });
  });
});
