import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { SessionCompactEvent, SessionEvent } from "../src/core/extensions/index.ts";
import compactionExtensionsSupport from "./compaction-extensions-support.ts";

const { awaited, runTest } = testing;
const { capturedEvents, cleanUp, createSession, extensionFrom, hasApiKey, prepare } =
  compactionExtensionsSupport;

const throwingExtension = () =>
  extensionFrom(
    new Map([
      [
        "session_before_compact",
        [
          (event: unknown) =>
            runTest(
              Effect.sync(() => {
                capturedEvents.push(event as SessionEvent);
                throw new Error("Extension intentionally throws");
              }),
            ),
        ],
      ],
      [
        "session_compact",
        [
          (event: unknown) =>
            runTest(Effect.sync(() => capturedEvents.push(event as SessionEvent))),
        ],
      ],
    ]),
  );

const continuesWithDefaultCompactionOnError = () =>
  runTest(
    Effect.gen(function* () {
      const session = yield* createSession([throwingExtension()]);
      yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());
      const result = yield* awaited(session.compact());
      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      const compactEvents = capturedEvents.filter(
        (event): event is SessionCompactEvent => event.type === "session_compact",
      );
      expect(compactEvents.length).toBe(1);
      expect(compactEvents[0]?.fromExtension).toBe(false);
    }),
  );

describe.skipIf(!hasApiKey)("Compaction extensions", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should continue with default compaction if extension throws error",
    continuesWithDefaultCompactionOnError,
    120000,
  );
});
