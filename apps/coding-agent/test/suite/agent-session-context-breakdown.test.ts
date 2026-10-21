import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import contextBreakdown from "../../src/core/context-breakdown.ts";
import messagesModule from "../../src/core/messages.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { apportion, measureContextBreakdown } = contextBreakdown;
const { convertToLlm } = messagesModule;

const { fauxAssistantMessage, fauxToolCall } = compat;

const { awaited, joinPath, runTest, writeTextFile } = testing;

const { createHarness } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

const countsTheSystemPromptAndToolDeclarations = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* awaited(createHarness());
      harnesses.push(harness);

      const breakdown = yield* awaited(harness.session.context.breakdown.getContextBreakdown());

      const parts = new Set(breakdown.entries.map((entry) => entry.part));
      expect([...parts].sort()).toEqual(["system", "tools"]);
      expect(breakdown.entries.filter((entry) => entry.part === "tools").length).toBe(
        harness.session.tools.loadout.getActiveToolNames().length,
      );
      expect(breakdown.tokens).toBeGreaterThan(0);
      expect(breakdown.entries.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(
        breakdown.tokens,
      );
    }),
  );

const splitsTheNextRequestIntoPromptSections = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* awaited(createHarness());
      harnesses.push(harness);
      yield* writeTextFile(joinPath(harness.tempDir, "a.txt"), "alpha ".repeat(400));
      yield* writeTextFile(joinPath(harness.tempDir, "b.txt"), "beta ".repeat(40));
      harness.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall("read", { path: joinPath(harness.tempDir, "a.txt") }),
            fauxToolCall("read", { path: joinPath(harness.tempDir, "b.txt") }),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]);
      yield* awaited(harness.session.run.prompting.prompt("read both files"));

      const breakdown = yield* awaited(harness.session.context.breakdown.getContextBreakdown());

      expect(breakdown.method).toBe("estimated");
      expect(breakdown.tokens).toBe(harness.session.context.stats.getContextUsage()?.tokens);
      expect(breakdown.entries.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(
        breakdown.tokens,
      );

      const names = (part: string) =>
        breakdown.entries.filter((entry) => entry.part === part).map((entry) => entry.name);
      expect(names("system")).toEqual(
        expect.arrayContaining(["preamble", "tools", "rules", "cwd"]),
      );
      expect(names("tools").sort()).toEqual(
        [...harness.session.tools.loadout.getActiveToolNames()].sort(),
      );
      expect(names("conversation").sort()).toEqual(["assistant", "user"]);
      expect(names("toolResults").sort()).toEqual(["bash", "read"]);
      expect(names("system")).not.toContain("updates");

      const read = breakdown.entries.find((e) => e.part === "toolResults" && e.name === "read");
      const bash = breakdown.entries.find((e) => e.part === "toolResults" && e.name === "bash");
      expect(read!.tokens).toBeGreaterThan(bash!.tokens);
    }),
  );

describe("AgentSession.getContextBreakdown", () => {
  it(
    "counts the system prompt and tool declarations the first request will carry",
    countsTheSystemPromptAndToolDeclarations,
  );

  it(
    "splits the next request into prompt sections, tools, and messages that sum to the context usage",
    splitsTheNextRequestIntoPromptSections,
  );
});

const scalesEstimatesToTheTotalAndHands = () => {
  const entries = apportion(
    [
      { estimate: 1, name: "a", part: "system" },
      { estimate: 1, name: "b", part: "system" },
      { estimate: 1, name: "c", part: "system" },
    ],
    10,
  );
  expect(entries.map((entry) => entry.tokens)).toEqual([4, 3, 3]);

  const scaled = apportion(
    [
      { estimate: 300, name: "x", part: "tools" },
      { estimate: 100, name: "y", part: "conversation" },
    ],
    1000,
  );
  expect(scaled.map((entry) => entry.tokens)).toEqual([750, 250]);
};

describe("apportion", () => {
  it(
    "scales estimates to the total and hands the rounding leftovers to the largest remainders",
    scalesEstimatesToTheTotalAndHands,
  );
});

const takesTheProviderCountAsAnExact = () =>
  runTest(
    Effect.gen(function* () {
      const breakdown = yield* measureContextBreakdown({
        addingProvider: undefined,
        convertToLlm,
        countTokens: () => Promise.resolve(123),
        messages: [
          { content: "", role: "system", sections: { preamble: "You help." }, timestamp: 0 },
          { content: "hello there", role: "user", timestamp: 1 },
        ],
        pending: [],
        transformContext: undefined,
        usageTokens: 50,
      });
      expect(breakdown.method).toBe("exact");
      expect(breakdown.tokens).toBe(123);
      expect(breakdown.entries.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(123);
      expect(breakdown.entries.map((entry) => `${entry.part}/${entry.name}`)).toEqual([
        "system/preamble",
        "conversation/user",
      ]);
    }),
  );

const keepsMsaSElementsAtTheirEstimates = () =>
  runTest(
    Effect.gen(function* () {
      const breakdown = yield* measureContextBreakdown({
        addingProvider: "claude-subs-main",
        convertToLlm,
        countTokens: () => Promise.resolve(undefined),
        messages: [{ content: "x".repeat(400), role: "user", timestamp: 1 }],
        pending: [],
        transformContext: undefined,
        usageTokens: 5_000,
      });
      expect(breakdown).toEqual({
        entries: [
          { name: "user", part: "conversation", tokens: 100 },
          { name: "claude-subs-main", part: "other", tokens: 4_900 },
        ],
        method: "estimated",
        tokens: 5_000,
      });
    }),
  );

const fallsBackToTheContextUsageWhen = () =>
  runTest(
    Effect.gen(function* () {
      const breakdown = yield* measureContextBreakdown({
        addingProvider: undefined,
        convertToLlm,
        countTokens: () =>
          runTest(
            Effect.sync(() => {
              throw new Error("count_tokens rejected");
            }),
          ),
        messages: [{ content: "hello there", role: "user", timestamp: 1 }],
        pending: [],
        transformContext: undefined,
        usageTokens: 50,
      });
      expect(breakdown).toEqual({
        entries: [{ name: "user", part: "conversation", tokens: 50 }],
        method: "estimated",
        tokens: 50,
      });
    }),
  );

describe("measureContextBreakdown", () => {
  it("takes the provider count as an exact total", takesTheProviderCountAsAnExact);

  it(
    "keeps msa's elements at their estimates and shows what another agent's provider added",
    keepsMsaSElementsAtTheirEstimates,
  );

  it(
    "falls back to the context usage when the provider cannot count",
    fallsBackToTheContextUsageWhen,
  );
});
