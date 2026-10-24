import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import compactionExtensionsSupport from "./compaction-extensions-support.ts";

const { awaited, runTest } = testing;
const { cleanUp, createExtension, createSession, hasLiveAuth, prepare } =
  compactionExtensionsSupport;

const shouldUseExtensionCompactionEvenWithDifferent = () =>
  runTest(
    Effect.gen(function* () {
      const customSummary = "Custom summary with modified values";

      const extension = createExtension((event) => {
        if (event.type === "session_before_compact") {
          return {
            compaction: {
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              summary: customSummary,
              tokensBefore: 999,
            },
          };
        }
        return undefined;
      });
      const session = yield* createSession([extension]);

      yield* awaited(session.run.prompting.prompt("What is 2+2? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());

      const result = yield* awaited(session.compaction.manual.compact());

      expect(result.summary).toBe(customSummary);
      expect(result.tokensBefore).toBe(999);
    }),
  );

describe.skipIf(!hasLiveAuth)("Compaction extensions", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should use extension compaction even with different values",
    shouldUseExtensionCompactionEvenWithDifferent,
    120000,
  );
});
