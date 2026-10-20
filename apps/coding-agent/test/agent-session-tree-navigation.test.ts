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

const beforeEachHook = () =>
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
    beforeEach(beforeEachHook);

    afterEach(() => {
      ctx2.cleanup();
    });

    it(
      "should navigate to user message and put text in editor",
      () =>
        runTest(
          Effect.gen(function* () {
            const { session } = ctx2;

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
  },
);

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))(
  "AgentSession tree navigation e2e",
  () => {
    beforeEach(beforeEachHook);

    afterEach(() => {
      ctx2.cleanup();
    });

    it(
      "should navigate to non-user message without editor text",
      () =>
        runTest(
          Effect.gen(function* () {
            const { session, sessionManager } = ctx2;

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
  },
);

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))(
  "AgentSession tree navigation e2e",
  () => {
    beforeEach(beforeEachHook);

    afterEach(() => {
      ctx2.cleanup();
    });

    it(
      "should create branch summary when navigating with summarize=true",
      () =>
        runTest(
          Effect.gen(function* () {
            const { session, sessionManager } = ctx2;

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
  },
);

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))(
  "AgentSession tree navigation e2e",
  () => {
    beforeEach(beforeEachHook);

    afterEach(() => {
      ctx2.cleanup();
    });

    it(
      "should attach summary to correct parent when navigating to nested user message",
      () =>
        runTest(
          Effect.gen(function* () {
            const { session, sessionManager } = ctx2;

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
  },
);
