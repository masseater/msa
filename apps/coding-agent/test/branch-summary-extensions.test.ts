import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import closeAgentSessionModule from "./close-agent-session.ts";
import harnessModule from "./suite/harness.ts";
import type harnessTypes from "./suite/harness.types.ts";
import utilities from "./utilities.ts";

const { cleanupAll } = closeAgentSessionModule;

const { createHarness } = harnessModule;
const { assistantMsg, userMsg } = utilities;

const { awaited, runTest } = testing;

const harnesses: harnessTypes.Harness[] = [];

const persistsExtensionProvidedSummaryUsageInSessionSetup = () =>
  Effect.sync(() => {
    const usage: compatTypes.Usage = {
      cacheRead: 30,
      cacheWrite: 40,
      cost: { cacheRead: 0.3, cacheWrite: 0.4, input: 0.1, output: 0.2, total: 1 },
      input: 10,
      output: 20,
      totalTokens: 100,
    };
    return { usage };
  });

const persistsExtensionProvidedSummaryUsageInSession = () =>
  runTest(
    Effect.gen(function* () {
      const { usage } = yield* persistsExtensionProvidedSummaryUsageInSessionSetup();
      const harness = yield* awaited(
        createHarness({
          extensionFactories: [
            (msa) => {
              msa.on("session_before_tree", () => ({
                summary: {
                  summary: "Summary provided by extension",
                  usage,
                },
              }));
            },
          ],
        }),
      );
      harnesses.push(harness);

      const targetId = harness.sessionManager.appendMessage(userMsg("first branch"));
      harness.sessionManager.appendMessage(assistantMsg("first reply"));
      harness.sessionManager.appendMessage(userMsg("abandoned branch work"));
      const sourceId = harness.sessionManager.appendMessage(assistantMsg("abandoned reply"));

      const result = yield* awaited(
        harness.session.context.tree.navigateTree(targetId, { summarize: true }),
      );
      const summaryEntry = result.summaryEntry;

      expect(summaryEntry?.type).toBe("branch_summary");

      expect(summaryEntry?.parentId).toBeNull();
      expect(summaryEntry?.fromId).toBe(sourceId);
      expect(summaryEntry?.fromHook).toBe(true);
      expect(summaryEntry?.summary).toBe("Summary provided by extension");
      expect(summaryEntry?.usage).toEqual(usage);

      const stats = harness.session.context.stats.getSessionStats();
      expect(stats.tokens).toEqual({
        cacheRead: 30,
        cacheWrite: 40,
        input: 12,
        output: 22,
        total: 104,
      });
      expect(stats.cost).toBe(1);
    }),
  );

const afterEachHook = () => cleanupAll(harnesses);

describe("Branch summary extensions", () => {
  afterEach(afterEachHook);

  it(
    "persists extension-provided summary usage in session totals",
    persistsExtensionProvidedSummaryUsageInSession,
  );
});
