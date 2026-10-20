import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createInMemoryModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } =
  testing;

let tempDir: string;

let extensionsDir: string;

function createRunner(...extensions: string[]) {
  return runTest(
    Effect.gen(function* () {
      yield* removePath(extensionsDir);
      yield* makeDirectory(extensionsDir);
      for (const [i, extension] of extensions.entries())
        yield* writeTextFile(joinPath(extensionsDir, `e${i}.ts`), extension);
      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const sm = SessionManager.inMemory();
      const mr = yield* awaited(createInMemoryModelRegistry(AuthStorage.inMemory()));
      return yield* awaited(
        new ExtensionRunner(result.extensions, result.runtime, tempDir, sm, mr),
      );
    }),
  );
}

const returnsContinueWhenNoHandlersUndefinedReturn = () =>
  runTest(
    Effect.gen(function* () {
      expect(
        (yield* awaited((yield* awaited(createRunner())).emitInput("x", undefined, "interactive")))
          .action,
      ).toBe("continue");

      let r = yield* awaited(createRunner(`export default p => p.on("input", async () => {});`));
      expect((yield* awaited(r.emitInput("x", undefined, "interactive"))).action).toBe("continue");

      r = yield* awaited(
        createRunner(`export default p => p.on("input", async () => ({ action: "continue" }));`),
      );
      expect((yield* awaited(r.emitInput("x", undefined, "interactive"))).action).toBe("continue");
    }),
  );

const transformsTextAndPreservesImagesWhenOmitted = () =>
  runTest(
    Effect.gen(function* () {
      const r = yield* awaited(
        createRunner(
          `export default p => p.on("input", async e => ({ action: "transform", text: "T:" + e.text }));`,
        ),
      );
      const imgs = [{ data: "orig", mimeType: "image/png", type: "image" as const }];
      const result = yield* awaited(r.emitInput("hi", imgs, "interactive"));
      expect(result).toEqual({ action: "transform", images: imgs, text: "T:hi" });
    }),
  );

const transformsAndReplacesImagesWhenProvided = () =>
  runTest(
    Effect.gen(function* () {
      const r = yield* awaited(
        createRunner(
          `export default p => p.on("input", async () => ({ action: "transform", text: "X", images: [{ type: "image", data: "new", mimeType: "image/jpeg" }] }));`,
        ),
      );
      const result = yield* awaited(
        r.emitInput(
          "hi",
          [{ data: "orig", mimeType: "image/png", type: "image" as const }],
          "interactive",
        ),
      );
      expect(result).toEqual({
        action: "transform",
        images: [{ data: "new", mimeType: "image/jpeg", type: "image" as const }],
        text: "X",
      });
    }),
  );

const chainsTransformsAcrossMultipleHandlers = () =>
  runTest(
    Effect.gen(function* () {
      const r = yield* awaited(
        createRunner(
          `export default p => p.on("input", async e => ({ action: "transform", text: e.text + "[1]" }));`,
          `export default p => p.on("input", async e => ({ action: "transform", text: e.text + "[2]" }));`,
        ),
      );
      const result = yield* awaited(r.emitInput("X", undefined, "interactive"));
      expect(result).toEqual({ action: "transform", images: undefined, text: "X[1][2]" });
    }),
  );

const shortCircuitsOnHandledAndSkipsSubsequent = () =>
  runTest(
    Effect.gen(function* () {
      (globalThis as any).testVar = false;
      const r = yield* awaited(
        createRunner(
          `export default p => p.on("input", async () => ({ action: "handled" }));`,
          `export default p => p.on("input", async () => { globalThis.testVar = true; });`,
        ),
      );
      expect(yield* awaited(r.emitInput("X", undefined, "interactive"))).toEqual({
        action: "handled",
      });
      expect((globalThis as any).testVar).toBe(false);
    }),
  );

const passesSourceCorrectlyForAllSourceTypes = () =>
  runTest(
    Effect.gen(function* () {
      const r = yield* awaited(
        createRunner(
          `export default p => p.on("input", async e => { globalThis.testVar = e.source; return { action: "continue" }; });`,
        ),
      );
      for (const source of ["interactive", "rpc", "extension"] as const) {
        yield* awaited(r.emitInput("x", undefined, source));
        expect((globalThis as any).testVar).toBe(source);
      }
    }),
  );

const passesStreamingbehaviorCorrectly = () =>
  runTest(
    Effect.gen(function* () {
      const r = yield* awaited(
        createRunner(
          `export default p => p.on("input", async e => { globalThis.testVar = e.streamingBehavior; return { action: "continue" }; });`,
        ),
      );
      yield* awaited(r.emitInput("x", undefined, "interactive", "steer"));
      expect((globalThis as any).testVar).toBe("steer");
      yield* awaited(r.emitInput("x", undefined, "interactive", "followUp"));
      expect((globalThis as any).testVar).toBe("followUp");
      yield* awaited(r.emitInput("x", undefined, "interactive"));
      expect((globalThis as any).testVar).toBeUndefined();
    }),
  );

const catchesHandlerErrorsAndContinues = () =>
  runTest(
    Effect.gen(function* () {
      const r = yield* awaited(
        createRunner(
          `export default p => p.on("input", async () => { throw new Error("boom"); });`,
        ),
      );
      const errs: string[] = [];
      r.onError((e) => errs.push(e.error));
      const result = yield* awaited(r.emitInput("x", undefined, "interactive"));
      expect(result.action).toBe("continue");
      expect(errs).toContain("boom");
    }),
  );

const hashandlersReturnsCorrectValue = () =>
  runTest(
    Effect.gen(function* () {
      let r = yield* awaited(createRunner());
      expect(r.hasHandlers("input")).toBe(false);
      r = yield* awaited(createRunner(`export default p => p.on("input", async () => {});`));
      expect(r.hasHandlers("input")).toBe(true);
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-input-test-");
      extensionsDir = joinPath(tempDir, "extensions");
      yield* makeDirectory(extensionsDir);
      delete (globalThis as any).testVar;
    }),
  );

describe("Input Event", () => {
  beforeEach(beforeEachHook);

  afterEach(() => runTest(removePath(tempDir)));

  it(
    "returns continue when no handlers, undefined return, or explicit continue",
    returnsContinueWhenNoHandlersUndefinedReturn,
  );

  it(
    "transforms text and preserves images when omitted",
    transformsTextAndPreservesImagesWhenOmitted,
  );

  it("transforms and replaces images when provided", transformsAndReplacesImagesWhenProvided);

  it("chains transforms across multiple handlers", chainsTransformsAcrossMultipleHandlers);

  it(
    "short-circuits on handled and skips subsequent handlers",
    shortCircuitsOnHandledAndSkipsSubsequent,
  );

  it("passes source correctly for all source types", passesSourceCorrectlyForAllSourceTypes);

  it("passes streamingBehavior correctly", passesStreamingbehaviorCorrectly);

  it("catches handler errors and continues", catchesHandlerErrorsAndContinues);

  it("hasHandlers returns correct value", hashandlersReturnsCorrectValue);
});
