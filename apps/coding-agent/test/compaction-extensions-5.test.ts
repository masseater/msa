import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { SessionBeforeCompactEvent } from "../src/core/extensions/index.ts";
import compactionExtensionsSupport from "./compaction-extensions-support.ts";

const { awaited, runTest } = testing;
const { cleanUp, createExtension, createSession, hasApiKey, prepare } = compactionExtensionsSupport;

const shouldPassCorrectDataInBeforeCompact = () =>
  runTest(
    Effect.gen(function* () {
      let capturedBeforeEvent: SessionBeforeCompactEvent | null = null;

      const extension = createExtension((event) => {
        capturedBeforeEvent = event;
        return undefined;
      });
      const session = yield* createSession([extension]);

      yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());

      yield* awaited(session.prompt("What is 3+3? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());

      yield* awaited(session.compact());

      expect(capturedBeforeEvent).not.toBeNull();
      const event = capturedBeforeEvent!;
      expect(typeof event.preparation.isSplitTurn).toBe("boolean");
      expect(event.preparation.firstKeptEntryId).toBeDefined();

      expect(Array.isArray(event.preparation.messagesToSummarize)).toBe(true);
      expect(Array.isArray(event.preparation.turnPrefixMessages)).toBe(true);

      expect(typeof event.preparation.tokensBefore).toBe("number");

      expect(Array.isArray(event.branchEntries)).toBe(true);

      expect(typeof session.sessionManager.getEntries).toBe("function");
      expect(typeof session.modelRuntime.getAuth).toBe("function");

      const entries = session.sessionManager.getEntries();
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
    }),
  );

describe.skipIf(!hasApiKey)("Compaction extensions", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should pass correct data in before_compact event",
    shouldPassCorrectDataInBeforeCompact,
    120000,
  );
});
