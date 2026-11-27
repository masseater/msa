import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import agentSessionCompactionLiveSupport from "./agent-session-compaction-live-support.ts";
import utilities from "./utilities.ts";

const { hasLiveAuth } = utilities;

const { awaited, runTest } = testing;

const live = agentSessionCompactionLiveSupport.liveCompaction();

const { afterEachHook, beforeEachHook, createSession } = live;

describe.skipIf(!hasLiveAuth)("AgentSession compaction e2e", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "should trigger manual compaction via compact()",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession());

          yield* awaited(
            live.session.run.prompting.prompt("What is 2+2? Reply with just the number."),
          );
          yield* awaited(live.session.agent.waitForIdle());

          yield* awaited(
            live.session.run.prompting.prompt("What is 3+3? Reply with just the number."),
          );
          yield* awaited(live.session.agent.waitForIdle());

          const result = yield* awaited(live.session.compaction.manual.compact());

          expect(result.summary).toBeDefined();
          expect(result.summary.length).toBeGreaterThan(0);
          expect(result.tokensBefore).toBeGreaterThan(0);

          const messages = live.session.messages;
          expect(messages.length).toBeGreaterThan(0);

          const firstMsg = messages[0];
          expect(firstMsg?.role).toBe("compactionSummary");
        }),
      ),
    120000,
  );
});

describe.skipIf(!hasLiveAuth)("AgentSession compaction e2e", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "should maintain valid session state after compaction",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession());

          yield* awaited(
            live.session.run.prompting.prompt("What is the capital of France? One word answer."),
          );
          yield* awaited(live.session.agent.waitForIdle());

          yield* awaited(
            live.session.run.prompting.prompt("What is the capital of Germany? One word answer."),
          );
          yield* awaited(live.session.agent.waitForIdle());

          yield* awaited(live.session.compaction.manual.compact());

          yield* awaited(
            live.session.run.prompting.prompt("What is the capital of Italy? One word answer."),
          );
          yield* awaited(live.session.agent.waitForIdle());

          expect(live.session.messages.length).toBeGreaterThan(0);

          const assistantMessages = live.session.messages.filter((m) => m.role === "assistant");
          expect(assistantMessages.length).toBeGreaterThan(0);
        }),
      ),
    180000,
  );
});

describe.skipIf(!hasLiveAuth)("AgentSession compaction e2e", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "should persist compaction to session file",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession());

          yield* awaited(live.session.run.prompting.prompt("Say hello"));
          yield* awaited(live.session.agent.waitForIdle());

          yield* awaited(live.session.run.prompting.prompt("Say goodbye"));
          yield* awaited(live.session.agent.waitForIdle());

          yield* awaited(live.session.compaction.manual.compact());

          const entries = live.sessionManager.getEntries();

          const compactionEntries = entries.filter((e) => e.type === "compaction");
          expect(compactionEntries.length).toBe(1);

          const compaction = compactionEntries[0];
          if (compaction === undefined) throw new Error("expected a compaction entry");
          expect(compaction.type).toBe("compaction");
          if (compaction.type === "compaction") {
            expect(compaction.summary.length).toBeGreaterThan(0);
            expect(typeof compaction.firstKeptEntryId).toBe("string");
            expect(compaction.tokensBefore).toBeGreaterThan(0);
          }
        }),
      ),
    120000,
  );
});
