import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import compactionExtensionsSupport from "./compaction-extensions-support.ts";

const { awaited, runTest } = testing;
const { capturedEvents, cleanUp, createExtension, createSession, hasApiKey, prepare } =
  compactionExtensionsSupport;

const shouldAllowExtensionsToProvideCustomCompaction = () =>
  runTest(
    Effect.gen(function* () {
      const customSummary = "Custom summary from extension";

      const extension = createExtension((event) => {
        if (event.type === "session_before_compact") {
          return {
            compaction: {
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              summary: customSummary,
              tokensBefore: event.preparation.tokensBefore,
            },
          };
        }
        return undefined;
      });
      const session = yield* createSession([extension]);

      yield* awaited(session.run.prompting.prompt("What is 2+2? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());

      yield* awaited(session.run.prompting.prompt("What is 3+3? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());

      const result = yield* awaited(session.compaction.manual.compact());

      expect(result.summary).toBe(customSummary);

      const compactEvents = capturedEvents.filter((e) => e.type === "session_compact");
      expect(compactEvents.length).toBe(1);

      const afterEvent = compactEvents[0];
      if (afterEvent === undefined) throw new Error("expected a session_compact event");
      if (afterEvent.type === "session_compact") {
        expect(afterEvent.compactionEntry.summary).toBe(customSummary);
        expect(afterEvent.fromExtension).toBe(true);
      }
    }),
  );

describe.skipIf(!hasApiKey)("Compaction extensions", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should allow extensions to provide custom compaction",
    shouldAllowExtensionsToProvideCustomCompaction,
    120000,
  );
});

const shouldIncludeEntriesInCompactEventAfter = () =>
  runTest(
    Effect.gen(function* () {
      const extension = createExtension();
      const session = yield* createSession([extension]);

      yield* awaited(session.run.prompting.prompt("What is 2+2? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());

      yield* awaited(session.compaction.manual.compact());

      const compactEvents = capturedEvents.filter((e) => e.type === "session_compact");
      expect(compactEvents.length).toBe(1);

      const afterEvent = compactEvents[0];
      if (afterEvent === undefined) throw new Error("expected a session_compact event");
      if (afterEvent.type === "session_compact") {
        const entries = session.sessionManager.getEntries();
        const hasCompactionEntry = entries.some((e: { type: string }) => e.type === "compaction");
        expect(hasCompactionEntry).toBe(true);
      }
    }),
  );

describe.skipIf(!hasApiKey)("Compaction extensions", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should include entries in compact event after compaction is saved",
    shouldIncludeEntriesInCompactEventAfter,
    120000,
  );
});
