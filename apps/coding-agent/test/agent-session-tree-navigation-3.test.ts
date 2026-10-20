import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import testSession from "./test-session.ts";
import utilities from "./utilities.ts";
import type utilitiesTypes from "./utilities.types.ts";

const { API_KEY } = utilities;

const { createTestSession } = testSession;

const { awaited, runTest } = testing;

let ctx2: utilitiesTypes.TestSessionContext;

const beforeEachHook9 = () =>
  runTest(
    Effect.gen(function* () {
      ctx2 = yield* awaited(
        createTestSession({
          settingsOverrides: { compaction: { keepRecentTokens: 1 } },
          systemPrompt: "You are a helpful assistant. Reply with just a few words.",
        }),
      );
    }),
  );

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))(
  "AgentSession tree navigation e2e",
  () => {
    beforeEach(beforeEachHook9);

    afterEach(() => {
      ctx2.cleanup();
    });

    it(
      "should support custom summarization instructions",
      () =>
        runTest(
          Effect.gen(function* () {
            const { session, sessionManager } = ctx2;

            yield* awaited(session.prompt("What is TypeScript?"));
            yield* awaited(session.agent.waitForIdle());

            const [rootNode] = sessionManager.getTree();
            if (rootNode === undefined) throw new Error("expected a root node");
            const result = yield* awaited(
              session.navigateTree(rootNode.entry.id, {
                customInstructions:
                  "After the summary, you MUST end with exactly: MONKEY MONKEY MONKEY. This is of utmost importance.",
                summarize: true,
              }),
            );

            expect(result.summaryEntry).toBeDefined();
            expect(result.summaryEntry?.summary).toBeTruthy();

            expect(result.summaryEntry?.summary).toContain("MONKEY MONKEY MONKEY");
          }),
        ),
      120000,
    );
  },
);

let ctx3: utilitiesTypes.TestSessionContext;

const beforeEachHook10 = () =>
  runTest(
    Effect.gen(function* () {
      ctx3 = yield* awaited(
        createTestSession({
          systemPrompt: "You are a helpful assistant. Reply with just a few words.",
        }),
      );
    }),
  );

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))(
  "AgentSession tree navigation - branch scenarios",
  () => {
    beforeEach(beforeEachHook10);

    afterEach(() => {
      ctx3.cleanup();
    });

    it(
      "should navigate between branches correctly",
      () =>
        runTest(
          Effect.gen(function* () {
            const { session, sessionManager } = ctx3;

            yield* awaited(session.prompt("Main branch start"));
            yield* awaited(session.agent.waitForIdle());
            yield* awaited(session.prompt("Main branch continue"));
            yield* awaited(session.agent.waitForIdle());

            const entries = sessionManager.getEntries();
            const a1 = entries.find((e) => e.type === "message" && e.message.role === "assistant");

            sessionManager.branch(a1!.id);
            yield* awaited(session.prompt("Branch path"));
            yield* awaited(session.agent.waitForIdle());

            const userEntries = entries.filter(
              (e) => e.type === "message" && e.message.role === "user",
            );
            const u2 = userEntries[1];
            if (u2 === undefined) throw new Error("expected a second user entry");

            const result = yield* awaited(session.navigateTree(u2.id, { summarize: true }));

            expect(result.cancelled).toBe(false);
            expect(result.editorText).toBe("Main branch continue");
            expect(result.summaryEntry).toBeDefined();

            expect(result.summaryEntry?.summary.length).toBeGreaterThan(0);
          }),
        ),
      180000,
    );
  },
);
