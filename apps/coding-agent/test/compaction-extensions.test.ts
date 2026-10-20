import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type extensionsTypes from "../src/core/extensions/index.types.ts";
import compactionExtensionsSupport from "./compaction-extensions-support.ts";

const { awaited, runTest } = testing;
const { capturedEvents, cleanUp, createExtension, createSession, hasApiKey, prepare } =
  compactionExtensionsSupport;

const shouldEmitBeforeCompactAndCompactEvents = () =>
  runTest(
    Effect.gen(function* () {
      const extension = createExtension();
      const session = yield* createSession([extension]);

      yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());

      yield* awaited(session.prompt("What is 3+3? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());

      yield* awaited(session.compact());

      const beforeCompactEvents = capturedEvents.filter(
        (e): e is extensionsTypes.SessionBeforeCompactEvent => e.type === "session_before_compact",
      );
      const compactEvents = capturedEvents.filter(
        (e): e is extensionsTypes.SessionCompactEvent => e.type === "session_compact",
      );

      expect(beforeCompactEvents.length).toBe(1);
      expect(compactEvents.length).toBe(1);

      const beforeEvent = beforeCompactEvents[0];
      if (beforeEvent === undefined) throw new Error("expected a session_before_compact event");
      expect(beforeEvent.preparation).toBeDefined();
      expect(beforeEvent.preparation.messagesToSummarize).toBeDefined();
      expect(beforeEvent.preparation.turnPrefixMessages).toBeDefined();
      expect(beforeEvent.preparation.tokensBefore).toBeGreaterThanOrEqual(0);
      expect(typeof beforeEvent.preparation.isSplitTurn).toBe("boolean");
      expect(beforeEvent.branchEntries).toBeDefined();

      const afterEvent = compactEvents[0];
      if (afterEvent === undefined) throw new Error("expected a session_compact event");
      expect(afterEvent.compactionEntry).toBeDefined();
      expect(afterEvent.compactionEntry.summary.length).toBeGreaterThan(0);
      expect(afterEvent.compactionEntry.tokensBefore).toBeGreaterThanOrEqual(0);
      expect(afterEvent.fromExtension).toBe(false);
    }),
  );

describe.skipIf(!hasApiKey)("Compaction extensions", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should emit before_compact and compact events",
    shouldEmitBeforeCompactAndCompactEvents,
    120000,
  );
});

const shouldAllowExtensionsToCancelCompaction = () =>
  runTest(
    Effect.gen(function* () {
      const extension = createExtension(() => ({ cancel: true }));
      const session = yield* createSession([extension]);

      yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());

      yield* awaited(expect(session.compact()).rejects.toThrow("Compaction cancelled"));

      const compactEvents = capturedEvents.filter((e) => e.type === "session_compact");
      expect(compactEvents.length).toBe(0);
    }),
  );

describe.skipIf(!hasApiKey)("Compaction extensions", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should allow extensions to cancel compaction",
    shouldAllowExtensionsToCancelCompaction,
    120000,
  );
});
