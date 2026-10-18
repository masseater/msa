import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { API_KEY, createTestSession, type TestSessionContext } from "./utilities.ts";

describe.skipIf(!API_KEY)("AgentSession tree navigation e2e", () => {
  let ctx: TestSessionContext;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        ctx = yield* awaited(
          createTestSession({
            systemPrompt: "You are a helpful assistant. Reply with just a few words.",
            settingsOverrides: { compaction: { keepRecentTokens: 1 } },
          }),
        );
      }),
    ),
  );

  afterEach(() => {
    ctx.cleanup();
  });

  it(
    "should navigate to user message and put text in editor",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session } = ctx;

          yield* awaited(session.prompt("First message"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.prompt("Second message"));
          yield* awaited(session.agent.waitForIdle());

          const tree = session.sessionManager.getTree();
          expect(tree.length).toBe(1);

          const rootNode = tree[0];
          if (rootNode === undefined) throw new Error("expected a root node");
          expect(rootNode.entry.type).toBe("message");

          const result = yield* awaited(
            session.navigateTree(rootNode.entry.id, { summarize: false }),
          );

          expect(result.cancelled).toBe(false);
          expect(result.editorText).toBe("First message");

          expect(session.sessionManager.getLeafId()).toBeNull();
        }),
      ),
    60000,
  );

  it(
    "should navigate to non-user message without editor text",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx;

          yield* awaited(session.prompt("Hello"));
          yield* awaited(session.agent.waitForIdle());

          const entries = sessionManager.getEntries();
          const assistantEntry = entries.find(
            (e) => e.type === "message" && e.message.role === "assistant",
          );
          expect(assistantEntry).toBeDefined();

          const result = yield* awaited(
            session.navigateTree(assistantEntry!.id, { summarize: false }),
          );

          expect(result.cancelled).toBe(false);
          expect(result.editorText).toBeUndefined();

          expect(sessionManager.getLeafId()).toBe(assistantEntry!.id);
        }),
      ),
    60000,
  );

  it(
    "should create branch summary when navigating with summarize=true",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx;

          yield* awaited(session.prompt("What is 2+2?"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.prompt("What is 3+3?"));
          yield* awaited(session.agent.waitForIdle());

          const tree = sessionManager.getTree();
          const rootNode = tree[0];
          if (rootNode === undefined) throw new Error("expected a root node");

          const result = yield* awaited(
            session.navigateTree(rootNode.entry.id, { summarize: true }),
          );

          expect(result.cancelled).toBe(false);
          expect(result.editorText).toBe("What is 2+2?");
          expect(result.summaryEntry).toBeDefined();
          expect(result.summaryEntry?.type).toBe("branch_summary");
          expect(result.summaryEntry?.summary).toBeTruthy();
          expect(result.summaryEntry?.summary.length).toBeGreaterThan(0);

          expect(result.summaryEntry?.parentId).toBeNull();

          expect(sessionManager.getLeafId()).toBe(result.summaryEntry?.id);
        }),
      ),
    120000,
  );

  it(
    "should attach summary to correct parent when navigating to nested user message",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx;

          yield* awaited(session.prompt("Message one"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.prompt("Message two"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.prompt("Message three"));
          yield* awaited(session.agent.waitForIdle());

          const entries = sessionManager.getEntries();
          const userEntries = entries.filter(
            (e) => e.type === "message" && e.message.role === "user",
          );
          expect(userEntries.length).toBe(3);

          const u2 = userEntries[1];
          if (u2 === undefined) throw new Error("expected a second user entry");
          const a1 = entries.find((e) => e.id === u2.parentId);

          const result = yield* awaited(session.navigateTree(u2.id, { summarize: true }));

          expect(result.cancelled).toBe(false);
          expect(result.editorText).toBe("Message two");
          expect(result.summaryEntry).toBeDefined();

          expect(result.summaryEntry?.parentId).toBe(a1?.id);

          const children = sessionManager.getChildren(a1!.id);
          expect(children.length).toBe(2);

          const childTypes = children.map((c) => c.type).sort();
          expect(childTypes).toContain("branch_summary");
          expect(childTypes).toContain("message");
        }),
      ),
    120000,
  );

  it(
    "should attach summary to selected node when navigating to assistant message",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx;

          yield* awaited(session.prompt("Hello"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.prompt("Goodbye"));
          yield* awaited(session.agent.waitForIdle());

          const entries = sessionManager.getEntries();
          const assistantEntries = entries.filter(
            (e) => e.type === "message" && e.message.role === "assistant",
          );
          const a1 = assistantEntries[0];
          if (a1 === undefined) throw new Error("expected an assistant entry");

          const result = yield* awaited(session.navigateTree(a1.id, { summarize: true }));

          expect(result.cancelled).toBe(false);
          expect(result.editorText).toBeUndefined();
          expect(result.summaryEntry).toBeDefined();

          expect(result.summaryEntry?.parentId).toBe(a1.id);

          expect(sessionManager.getLeafId()).toBe(result.summaryEntry?.id);
        }),
      ),
    120000,
  );

  it(
    "should handle abort during summarization",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx;

          yield* awaited(session.prompt("Tell me about something"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.prompt("Continue"));
          yield* awaited(session.agent.waitForIdle());

          const entriesBefore = sessionManager.getEntries();
          const leafBefore = sessionManager.getLeafId();

          const tree = sessionManager.getTree();
          const rootNode = tree[0];
          if (rootNode === undefined) throw new Error("expected a root node");

          const navigationPromise = session.navigateTree(rootNode.entry.id, { summarize: true });

          yield* Effect.sleep(100);

          expect(session.isCompacting).toBe(true);

          session.abortBranchSummary();

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

  it(
    "should not create summary when navigating without summarize option",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx;

          yield* awaited(session.prompt("First"));
          yield* awaited(session.agent.waitForIdle());
          yield* awaited(session.prompt("Second"));
          yield* awaited(session.agent.waitForIdle());

          const entriesBefore = sessionManager.getEntries().length;

          const [rootNode] = sessionManager.getTree();
          if (rootNode === undefined) throw new Error("expected a root node");
          yield* awaited(session.navigateTree(rootNode.entry.id, { summarize: false }));

          const entriesAfter = sessionManager.getEntries().length;
          expect(entriesAfter).toBe(entriesBefore);

          const summaries = sessionManager.getEntries().filter((e) => e.type === "branch_summary");
          expect(summaries.length).toBe(0);
        }),
      ),
    60000,
  );

  it(
    "should handle navigation to same position (no-op)",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx;

          yield* awaited(session.prompt("Hello"));
          yield* awaited(session.agent.waitForIdle());

          const leafBefore = sessionManager.getLeafId();
          expect(leafBefore).toBeTruthy();
          const entriesBefore = sessionManager.getEntries().length;

          const result = yield* awaited(session.navigateTree(leafBefore!, { summarize: false }));

          expect(result.cancelled).toBe(false);
          expect(sessionManager.getLeafId()).toBe(leafBefore);
          expect(sessionManager.getEntries().length).toBe(entriesBefore);
        }),
      ),
    60000,
  );

  it(
    "should support custom summarization instructions",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx;

          yield* awaited(session.prompt("What is TypeScript?"));
          yield* awaited(session.agent.waitForIdle());

          const [rootNode] = sessionManager.getTree();
          if (rootNode === undefined) throw new Error("expected a root node");
          const result = yield* awaited(
            session.navigateTree(rootNode.entry.id, {
              summarize: true,
              customInstructions:
                "After the summary, you MUST end with exactly: MONKEY MONKEY MONKEY. This is of utmost importance.",
            }),
          );

          expect(result.summaryEntry).toBeDefined();
          expect(result.summaryEntry?.summary).toBeTruthy();

          expect(result.summaryEntry?.summary).toContain("MONKEY MONKEY MONKEY");
        }),
      ),
    120000,
  );
});

describe.skipIf(!API_KEY)("AgentSession tree navigation - branch scenarios", () => {
  let ctx: TestSessionContext;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        ctx = yield* awaited(
          createTestSession({
            systemPrompt: "You are a helpful assistant. Reply with just a few words.",
          }),
        );
      }),
    ),
  );

  afterEach(() => {
    ctx.cleanup();
  });

  it(
    "should navigate between branches correctly",
    () =>
      runTest(
        Effect.gen(function* () {
          const { session, sessionManager } = ctx;

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
});
