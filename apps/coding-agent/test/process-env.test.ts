import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import processEnv from "../src/core/process-env.ts";

const { deleteEnv, envNames, envSnapshot, readEnv, withEnv, writeEnv } = processEnv;

const { runTest } = testing;

const readsTheProcessEnvironment = () => {
  expect(readEnv("MSA_PROCESS_ENV_TEST_MISSING")).toBeUndefined();
  expect(envNames().length).toBeGreaterThan(0);
};

const writesAndDeletesValuesInsideAScope = () =>
  runTest(
    Effect.gen(function* () {
      expect(readEnv("MSA_PROCESS_ENV_WRITTEN")).toBeUndefined();
      yield* Effect.sync(() => writeEnv("MSA_PROCESS_ENV_WRITTEN", "inside"));
      expect(readEnv("MSA_PROCESS_ENV_WRITTEN")).toBe("inside");
      expect(envSnapshot()["MSA_PROCESS_ENV_WRITTEN"]).toBe("inside");
      yield* Effect.sync(() => deleteEnv("MSA_PROCESS_ENV_WRITTEN"));
      expect(readEnv("MSA_PROCESS_ENV_WRITTEN")).toBeUndefined();
    }),
  );

const restoresOverridesAfterTheScopeEnds = () =>
  runTest(
    Effect.gen(function* () {
      expect(readEnv("MSA_PROCESS_ENV_SCOPED")).toBe("first");
      yield* Effect.sync(() => {
        expect(readEnv("MSA_PROCESS_ENV_SCOPED")).toBe("second");
      }).pipe(withEnv({ MSA_PROCESS_ENV_SCOPED: "second" }));
      expect(readEnv("MSA_PROCESS_ENV_SCOPED")).toBe("first");
    }).pipe(withEnv({ MSA_PROCESS_ENV_SCOPED: "first" })),
  );

const treatsUndefinedOverridesAsUnset = () =>
  runTest(
    Effect.gen(function* () {
      yield* Effect.void;
      expect(readEnv("MSA_PROCESS_ENV_UNSET")).toBeUndefined();
      expect(Object.hasOwn(envSnapshot(), "MSA_PROCESS_ENV_UNSET")).toBe(false);
    }).pipe(withEnv({ MSA_PROCESS_ENV_UNSET: undefined })),
  );

describe("process environment", () => {
  it("reads the process environment", readsTheProcessEnvironment);

  it("writes and deletes values inside a scope", writesAndDeletesValuesInsideAScope);

  it("restores overrides after the scope ends", restoresOverridesAfterTheScopeEnds);

  it("treats undefined overrides as unset", treatsUndefinedOverridesAsUnset);
});
