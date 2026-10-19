import { runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  deleteEnv,
  envNames,
  envSnapshot,
  readEnv,
  withEnv,
  writeEnv,
} from "../src/core/process-env.ts";

describe("process environment", () => {
  it("reads the process environment", () => {
    expect(readEnv("MSA_PROCESS_ENV_TEST_MISSING")).toBeUndefined();
    expect(envNames().length).toBeGreaterThan(0);
  });

  it("writes and deletes values inside a scope", () =>
    runTest(
      Effect.gen(function* () {
        expect(readEnv("MSA_PROCESS_ENV_WRITTEN")).toBeUndefined();
        yield* Effect.sync(() => writeEnv("MSA_PROCESS_ENV_WRITTEN", "inside"));
        expect(readEnv("MSA_PROCESS_ENV_WRITTEN")).toBe("inside");
        expect(envSnapshot()["MSA_PROCESS_ENV_WRITTEN"]).toBe("inside");
        yield* Effect.sync(() => deleteEnv("MSA_PROCESS_ENV_WRITTEN"));
        expect(readEnv("MSA_PROCESS_ENV_WRITTEN")).toBeUndefined();
      }),
    ));

  it("restores overrides after the scope ends", () =>
    runTest(
      Effect.gen(function* () {
        expect(readEnv("MSA_PROCESS_ENV_SCOPED")).toBe("first");
        yield* Effect.sync(() => {
          expect(readEnv("MSA_PROCESS_ENV_SCOPED")).toBe("second");
        }).pipe(withEnv({ MSA_PROCESS_ENV_SCOPED: "second" }));
        expect(readEnv("MSA_PROCESS_ENV_SCOPED")).toBe("first");
      }).pipe(withEnv({ MSA_PROCESS_ENV_SCOPED: "first" })),
    ));

  it("treats undefined overrides as unset", () =>
    runTest(
      Effect.gen(function* () {
        yield* Effect.void;
        expect(readEnv("MSA_PROCESS_ENV_UNSET")).toBeUndefined();
        expect(Object.hasOwn(envSnapshot(), "MSA_PROCESS_ENV_UNSET")).toBe(false);
      }).pipe(withEnv({ MSA_PROCESS_ENV_UNSET: undefined })),
    ));
});
