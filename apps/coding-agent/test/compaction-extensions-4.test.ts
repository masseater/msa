import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import compactionExtensionsSupport from "./compaction-extensions-support.ts";

const { awaited, runTest } = testing;
const { cleanUp, createSession, extensionFrom, hasApiKey, prepare } = compactionExtensionsSupport;

const recordingExtension = (name: string, callOrder: string[]) =>
  extensionFrom(
    new Map([
      [
        "session_before_compact",
        [() => runTest(Effect.sync(() => callOrder.push(`${name}-before`)))],
      ],
      ["session_compact", [() => runTest(Effect.sync(() => callOrder.push(`${name}-after`)))]],
    ]),
  );

const callsMultipleExtensionsInOrder = () =>
  runTest(
    Effect.gen(function* () {
      const callOrder: string[] = [];
      const session = yield* createSession([
        recordingExtension("extension1", callOrder),
        recordingExtension("extension2", callOrder),
      ]);
      yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
      yield* awaited(session.agent.waitForIdle());
      yield* awaited(session.compact());
      expect(callOrder).toEqual([
        "extension1-before",
        "extension2-before",
        "extension1-after",
        "extension2-after",
      ]);
    }),
  );

describe.skipIf(!hasApiKey)("Compaction extensions", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it("should call multiple extensions in order", callsMultipleExtensionsInOrder, 120000);
});
