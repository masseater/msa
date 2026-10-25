import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import harnessModule from "./harness.ts";

const { awaited, failure, pathExists, runTest } = testing;
const { createHarness } = harnessModule;

const removesTheTempDirWhenClosingTheSessionFails = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* awaited(createHarness());
      const disposeError = new Error("dispose failed");
      const dispose = vi.spyOn(harness.session, "dispose").mockRejectedValueOnce(disposeError);
      const closing = harness.cleanup();
      const rejection = yield* failure(awaited(closing));
      dispose.mockRestore();
      yield* awaited(harness.session.dispose());
      expect(rejection).toBe(disposeError);
      expect(yield* pathExists(harness.tempDir)).toBe(false);
    }),
  );

describe("suite harness cleanup", () => {
  it(
    "removes the temp dir and rethrows when closing the session fails",
    removesTheTempDirWhenClosingTheSessionFails,
  );
});
