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
    "should work with --no-session mode (in-memory only)",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession(true));

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

          const entries = live.sessionManager.getEntries();
          const compactionEntries = entries.filter((e) => e.type === "compaction");
          expect(compactionEntries.length).toBe(1);
        }),
      ),
    120000,
  );
});

describe.skipIf(!hasLiveAuth)("AgentSession compaction e2e", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "should emit compaction events during manual compaction",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession());

          yield* awaited(live.session.run.prompting.prompt("Say hello"));
          yield* awaited(live.session.agent.waitForIdle());

          yield* awaited(live.session.compaction.manual.compact());

          const compactionEvents = live.events.filter(
            (e) => e.type === "compaction_start" || e.type === "compaction_end",
          );
          expect(compactionEvents).toHaveLength(2);
          expect(compactionEvents[0]).toEqual({
            reason: "manual",
            type: "compaction_start" as const,
          });
          expect(compactionEvents[1]).toMatchObject({
            aborted: false,
            reason: "manual",
            type: "compaction_end" as const,
            willRetry: false,
          });

          const messageEndEvents = live.events.filter((e) => e.type === "message_end");
          expect(messageEndEvents.length).toBeGreaterThan(0);
        }),
      ),
    120000,
  );
});
