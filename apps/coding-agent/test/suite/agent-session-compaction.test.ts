import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import codingAgent from "../../src/index.ts";
import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";
import agentSessionCompactionSupport2 from "./agent-session-compaction-support2.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { estimateTokens } = codingAgent;

const { fauxAssistantMessage } = ai;

const { afterEachHook } = agentSessionCompactionSupport2;

const { harnesses, seedCompactableSession } = agentSessionCompactionSupport;

const { createHarness, getUserTexts } = harnessModule;

const { currentTimeMillis } = testing;

const manuallyCompactsUsingAnExtensionProvidedPart1 = () =>
  Effect.gen(function* () {
    const summaryUsage = {
      cacheRead: 30,
      cacheWrite: 40,
      cost: { cacheRead: 0.3, cacheWrite: 0.4, input: 0.1, output: 0.2, total: 1 },
      input: 10,
      output: 20,
      totalTokens: 100,
    };
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("session_before_compact", (event) =>
              Promise.resolve({
                compaction: {
                  details: { source: "extension" },
                  firstKeptEntryId: event.preparation.firstKeptEntryId,
                  summary: "summary from extension",
                  tokensBefore: event.preparation.tokensBefore,
                  usage: summaryUsage,
                },
              }),
            );
          },
        ],
        settings: { compaction: { keepRecentTokens: 1 } },
      }),
    );
    return { harness, summaryUsage };
  });

const manuallyCompactsUsingAnExtensionProvided = Effect.gen(function* () {
  const { harness, summaryUsage } = yield* manuallyCompactsUsingAnExtensionProvidedPart1();
  harnesses.push(harness);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("one"));
  yield* Effect.promise(() => harness.session.run.prompting.prompt("two"));
  const statsBefore = harness.session.context.stats.getSessionStats();

  const result = yield* Effect.promise(() => harness.session.compaction.manual.compact());
  const compactionEntries = harness.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "compaction");
  const estimatedTokensAfter = harness.session.messages.reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );

  expect(result.summary).toBe("summary from extension");
  expect(result.usage).toEqual(summaryUsage);
  expect(result.estimatedTokensAfter).toBe(estimatedTokensAfter);
  expect(compactionEntries).toHaveLength(1);
  const compactionEntry = compactionEntries[0];
  if (compactionEntry?.type === "compaction") {
    expect(compactionEntry.usage).toEqual(summaryUsage);
  }
  const statsAfter = harness.session.context.stats.getSessionStats();
  expect(statsAfter.tokens.input).toBe(statsBefore.tokens.input + summaryUsage.input);
  expect(statsAfter.tokens.output).toBe(statsBefore.tokens.output + summaryUsage.output);
  expect(statsAfter.tokens.cacheRead).toBe(statsBefore.tokens.cacheRead + summaryUsage.cacheRead);
  expect(statsAfter.tokens.cacheWrite).toBe(
    statsBefore.tokens.cacheWrite + summaryUsage.cacheWrite,
  );
  expect(statsAfter.cost).toBe(statsBefore.cost + summaryUsage.cost.total);
  expect(harness.session.messages[0]?.role).toBe("system");
  expect(harness.session.messages[1]?.role).toBe("compactionSummary");
});

const checkpointsTheReplayedSystemStateAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("declared")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("declare the prompt"));
  const declared = harness.session.messages[0];
  if (declared?.role !== "system") throw new Error("expected declared system message");
  harness.sessionManager.appendMessage({
    content: "summarized instruction",
    role: "system",
    sections: { early: "<early>1</early>" },
    timestamp: currentTimeMillis(),
    toolsRemoved: [{ name: "bash" }],
  });
  const firstKeptEntryId = harness.sessionManager.appendMessage({
    content: [{ text: "kept before patch", type: "text" }],
    role: "user",
    timestamp: currentTimeMillis(),
  });
  harness.sessionManager.appendMessage({
    content: "retained instruction",
    role: "system",
    sections: { extra: "<extra>late</extra>" },
    timestamp: currentTimeMillis(),
    toolsRemoved: [{ name: "read" }],
  });
  return yield* checkpointsTheReplayedSystemStateAndStep1(harness, declared, firstKeptEntryId);
});

const checkpointsTheReplayedSystemStateAndStep1 = (
  harness: harnessTypes.Harness,
  declared: agentTypes.AgentMessage | undefined,
  firstKeptEntryId: string,
) =>
  Effect.sync(() => {
    harness.sessionManager.appendMessage({
      content: [{ text: "kept after patch", type: "text" }],
      role: "user",
      timestamp: currentTimeMillis(),
    });
    harness.sessionManager.appendCompaction("compacted", firstKeptEntryId, 100);
    const messages = harness.sessionManager.buildSessionContext().messages;
    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "compactionSummary",
      "user",
      "user",
    ]);
    const checkpoint = messages[0];
    if (checkpoint?.role !== "system") throw new Error("expected checkpoint system message");
    if (declared?.role !== "system") throw new Error("expected declared system message");
    expect(checkpoint.content).toBe("summarized instruction\n\nretained instruction");
    expect(checkpoint.sections).toEqual({
      ...declared.sections,
      early: "<early>1</early>",
      extra: "<extra>late</extra>",
    });
    expect(checkpoint.toolsAdded?.map((tool) => tool.name)).toEqual(
      harness.session.tools.loadout
        .getActiveToolNames()
        .filter((name) => name !== "read" && name !== "bash"),
    );
  });

const allowsAQueuedPromptToStart = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                details: {},
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                summary: "manual compacted",
                tokensBefore: event.preparation.tokensBefore,
              },
            }),
          );
        },
      ],
      settings: { compaction: { keepRecentTokens: 1 } },
    }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.setResponses([fauxAssistantMessage("queued response")]);

  let queuedPrompt: Promise<void> | undefined;
  harness.session.subscribe((event) => {
    if (
      event.type === "compaction_end" &&
      event.reason === "manual" &&
      event.result !== undefined
    ) {
      expect(harness.session.compaction.manual.isCompacting).toBe(false);
      queuedPrompt = harness.session.run.prompting.prompt("queued after compaction");
    }
  });

  yield* Effect.promise(() => harness.session.compaction.manual.compact());
  if (queuedPrompt === undefined) throw new Error("compaction_end did not start the queued prompt");
  yield* Effect.promise(() => Promise.resolve(queuedPrompt));

  expect(getUserTexts(harness)).toContain("queued after compaction");
  expect(harness.session.context.transcript.getLastAssistantText()).toBe("queued response");
});

const throwsWhenCompactingWithoutAModel = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.session.agent.state.model = undefined as unknown as aiTypes.Model<any>;

  yield* Effect.promise(() =>
    expect(harness.session.compaction.manual.compact()).rejects.toThrow("No model selected"),
  );
});

const throwsWhenCompactingWithoutConfiguredAuth = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);

  seedCompactableSession(harness);

  yield* Effect.promise(() =>
    expect(harness.session.compaction.manual.compact()).rejects.toThrow(
      `No API key found for ${harness.getModel().provider}.`,
    ),
  );
});

const manuallyCompactsUsingAnExtensionProvidedSummary = () =>
  Effect.runPromise(manuallyCompactsUsingAnExtensionProvided);

const checkpointsTheReplayedSystemStateAndFolds = () =>
  Effect.runPromise(checkpointsTheReplayedSystemStateAnd);

const allowsAQueuedPromptToStartWhen = () => Effect.runPromise(allowsAQueuedPromptToStart);

const throwsWhenCompactingWithoutAModel2 = () =>
  Effect.runPromise(throwsWhenCompactingWithoutAModel);

const throwsWhenCompactingWithoutConfiguredAuth2 = () =>
  Effect.runPromise(throwsWhenCompactingWithoutConfiguredAuth);

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook);

  it(
    "manually compacts using an extension-provided summary",
    manuallyCompactsUsingAnExtensionProvidedSummary,
  );

  it(
    "checkpoints the replayed system state and folds summarized and retained system patches into it",
    checkpointsTheReplayedSystemStateAndFolds,
  );

  it("allows a queued prompt to start when manual compaction ends", allowsAQueuedPromptToStartWhen);

  it("throws when compacting without a model", throwsWhenCompactingWithoutAModel2);

  it("throws when compacting without configured auth", throwsWhenCompactingWithoutConfiguredAuth2);
});
