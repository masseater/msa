import * as fs from "node:fs";
import * as os from "node:os";

import { awaited, runTest, writeTextFile, makeDirectory, removePath, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";

describe("Input Event", () => {
  let tempDir: string;
  let extensionsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(joinPath(os.tmpdir(), "msa-input-test-"));
    extensionsDir = joinPath(tempDir, "extensions");
    fs.mkdirSync(extensionsDir);

    delete (globalThis as any).testVar;
  });

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

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

  it("returns continue when no handlers, undefined return, or explicit continue", () =>
    runTest(
      Effect.gen(function* () {
        expect(
          (yield* awaited(
            (yield* awaited(createRunner())).emitInput("x", undefined, "interactive"),
          )).action,
        ).toBe("continue");

        let r = yield* awaited(createRunner(`export default p => p.on("input", async () => {});`));
        expect((yield* awaited(r.emitInput("x", undefined, "interactive"))).action).toBe(
          "continue",
        );

        r = yield* awaited(
          createRunner(`export default p => p.on("input", async () => ({ action: "continue" }));`),
        );
        expect((yield* awaited(r.emitInput("x", undefined, "interactive"))).action).toBe(
          "continue",
        );
      }),
    ));

  it("transforms text and preserves images when omitted", () =>
    runTest(
      Effect.gen(function* () {
        const r = yield* awaited(
          createRunner(
            `export default p => p.on("input", async e => ({ action: "transform", text: "T:" + e.text }));`,
          ),
        );
        const imgs = [{ type: "image" as const, data: "orig", mimeType: "image/png" }];
        const result = yield* awaited(r.emitInput("hi", imgs, "interactive"));
        expect(result).toEqual({ action: "transform", text: "T:hi", images: imgs });
      }),
    ));

  it("transforms and replaces images when provided", () =>
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
            [{ type: "image" as const, data: "orig", mimeType: "image/png" }],
            "interactive",
          ),
        );
        expect(result).toEqual({
          action: "transform",
          text: "X",
          images: [{ type: "image" as const, data: "new", mimeType: "image/jpeg" }],
        });
      }),
    ));

  it("chains transforms across multiple handlers", () =>
    runTest(
      Effect.gen(function* () {
        const r = yield* awaited(
          createRunner(
            `export default p => p.on("input", async e => ({ action: "transform", text: e.text + "[1]" }));`,
            `export default p => p.on("input", async e => ({ action: "transform", text: e.text + "[2]" }));`,
          ),
        );
        const result = yield* awaited(r.emitInput("X", undefined, "interactive"));
        expect(result).toEqual({ action: "transform", text: "X[1][2]", images: undefined });
      }),
    ));

  it("short-circuits on handled and skips subsequent handlers", () =>
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
    ));

  it("passes source correctly for all source types", () =>
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
    ));

  it("passes streamingBehavior correctly", () =>
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
    ));

  it("catches handler errors and continues", () =>
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
    ));

  it("hasHandlers returns correct value", () =>
    runTest(
      Effect.gen(function* () {
        let r = yield* awaited(createRunner());
        expect(r.hasHandlers("input")).toBe(false);
        r = yield* awaited(createRunner(`export default p => p.on("input", async () => {});`));
        expect(r.hasHandlers("input")).toBe(true);
      }),
    ));
});
