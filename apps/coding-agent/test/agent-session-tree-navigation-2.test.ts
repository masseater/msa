import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import testSession from "./test-session.ts";
import utilities from "./utilities.ts";
import type utilitiesTypes from "./utilities.types.ts";

const { hasLiveAuth } = utilities;

const { createTestSession } = testSession;

const { awaited, runTest } = testing;

let ctx2: utilitiesTypes.TestSessionContext;

const beforeEachHook5 = () =>
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

describe.skipIf(!hasLiveAuth)("AgentSession tree navigation e2e", () => {
  beforeEach(beforeEachHook5);

  afterEach(() => {
    ctx2.cleanup();
  });

  it(
    "should attach summary to selected node when navigating to assistant message",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx2;

          yield* awaited(session.run.prompting.prompt("Hello"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.run.prompting.prompt("Goodbye"));
          yield* awaited(session.agent.waitForIdle());

          const entries = sessionManager.getEntries();
          const assistantEntries = entries.filter(
            (e) => e.type === "message" && e.message.role === "assistant",
          );
          const a1 = assistantEntries[0];
          if (a1 === undefined) throw new Error("expected an assistant entry");

          const result = yield* awaited(
            session.context.tree.navigateTree(a1.id, { summarize: true }),
          );

          expect(result.cancelled).toBe(false);
          expect(result.editorText).toBeUndefined();
          expect(result.summaryEntry).toBeDefined();

          expect(result.summaryEntry?.parentId).toBe(a1.id);

          expect(sessionManager.getLeafId()).toBe(result.summaryEntry?.id);
        }),
      ),
    120000,
  );
});

describe.skipIf(!hasLiveAuth)("AgentSession tree navigation e2e", () => {
  beforeEach(beforeEachHook5);

  afterEach(() => {
    ctx2.cleanup();
  });

  it(
    "should handle abort during summarization",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx2;

          yield* awaited(session.run.prompting.prompt("Tell me about something"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.run.prompting.prompt("Continue"));
          yield* awaited(session.agent.waitForIdle());

          const entriesBefore = sessionManager.getEntries();
          const leafBefore = sessionManager.getLeafId();

          const tree = sessionManager.getTree();
          const rootNode = tree[0];
          if (rootNode === undefined) throw new Error("expected a root node");

          const navigationPromise = session.context.tree.navigateTree(rootNode.entry.id, {
            summarize: true,
          });

          yield* Effect.sleep(100);

          expect(session.compaction.manual.isCompacting).toBe(true);

          session.context.tree.abortBranchSummary();

          const result = yield* awaited(navigationPromise);

          expect(result.cancelled).toBe(true);
          expect(result.aborted).toBe(true);
          expect(result.summaryEntry).toBeUndefined();

          const entriesAfter = sessionManager.getEntries();
          expect(entriesAfter.length).toBe(entriesBefore.length);
          expect(sessionManager.getLeafId()).toBe(leafBefore);
        }),
      ),
    60000,
  );
});

describe.skipIf(!hasLiveAuth)("AgentSession tree navigation e2e", () => {
  beforeEach(beforeEachHook5);

  afterEach(() => {
    ctx2.cleanup();
  });

  it(
    "should not create summary when navigating without summarize option",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx2;

          yield* awaited(session.run.prompting.prompt("First"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.run.prompting.prompt("Second"));
          yield* awaited(session.agent.waitForIdle());

          const entriesBefore = sessionManager.getEntries().length;

          const [rootNode] = sessionManager.getTree();
          if (rootNode === undefined) throw new Error("expected a root node");
          yield* awaited(
            session.context.tree.navigateTree(rootNode.entry.id, { summarize: false }),
          );

          const entriesAfter = sessionManager.getEntries().length;
          expect(entriesAfter).toBe(entriesBefore);

          const summaries = sessionManager.getEntries().filter((e) => e.type === "branch_summary");
          expect(summaries.length).toBe(0);
        }),
      ),
    60000,
  );
});

describe.skipIf(!hasLiveAuth)("AgentSession tree navigation e2e", () => {
  beforeEach(beforeEachHook5);

  afterEach(() => {
    ctx2.cleanup();
  });

  it(
    "should handle navigation to same position (no-op)",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx2;

          yield* awaited(session.run.prompting.prompt("Hello"));
          yield* awaited(session.agent.waitForIdle());

          const leafBefore = sessionManager.getLeafId();
          expect(leafBefore).toBeTruthy();
          const entriesBefore = sessionManager.getEntries().length;

          const result = yield* awaited(
            session.context.tree.navigateTree(leafBefore!, { summarize: false }),
          );

          expect(result.cancelled).toBe(false);
          expect(sessionManager.getLeafId()).toBe(leafBefore);
          expect(sessionManager.getEntries().length).toBe(entriesBefore);
        }),
      ),
    60000,
  );
});
