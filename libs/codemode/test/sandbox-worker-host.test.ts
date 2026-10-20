import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { CodemodeSandbox } from "../src/index.ts";
import sandboxSupport from "./sandbox-support.ts";
import support from "./support.ts";

const { closeSandboxes, track, useBackend } = sandboxSupport;
const { toJson } = support;

const acceptsAWorkerPathString = Effect.gen(function* () {
  const workerPath = fileURLToPath(new URL("../src/runtime/worker.ts", import.meta.url));
  const sandbox = new CodemodeSandbox({ workerUrl: workerPath });
  track(sandbox);
  expect(yield* Effect.promise(() => sandbox.execute("return 1"))).toMatchObject({
    ok: true,
    value: 1,
  });
});

const reportsAMissingWorkerFileAs = Effect.gen(function* () {
  const sandbox = new CodemodeSandbox({
    workerUrl: new URL("./does-not-exist.js", import.meta.url),
  });
  track(sandbox);
  expect(yield* Effect.promise(() => sandbox.execute("return 1"))).toMatchObject({
    error: { kind: "sandbox" },
    ok: false,
  });
});

const reportsAFailingWasmModuleAs = Effect.gen(function* () {
  const sandbox = new CodemodeSandbox({ wasm: Promise.reject(new Error("no wasm")) });
  track(sandbox);
  expect(yield* Effect.promise(() => sandbox.execute("return 1"))).toMatchObject({
    error: { kind: "sandbox", message: "Failed to load QuickJS: no wasm" },
    ok: false,
  });
});

const ignoresNodeWatchNotificationsFromThe = Effect.gen(function* () {
  const sandbox = new CodemodeSandbox({
    workerUrl: new URL("./fixtures/raw-worker.ts", import.meta.url),
  });
  track(sandbox);
  const script = yield* toJson([
    { "watch:require": ["/worker.js"] },
    { "watch:import": ["file:///worker.js"] },
    { ok: true, type: "done", value: "42", writes: "[]" },
  ]);
  const result = yield* Effect.promise(() => sandbox.execute(script));
  expect(result).toMatchObject({ ok: true, value: 42 });
});

const reportsABrokenBridge = Effect.fn(function* (message: object, reason: string) {
  const sandbox = new CodemodeSandbox({
    workerUrl: new URL("./fixtures/raw-worker.ts", import.meta.url),
  });
  track(sandbox);
  const script = yield* toJson(message);
  const result = yield* Effect.promise(() => sandbox.execute(script));
  expect(result).toMatchObject({ error: { kind: "sandbox" }, ok: false });
  expect(result.ok ? undefined : result.error.message).toContain(
    `Sandbox bridge broken: ${reason}`,
  );
});

afterEach(closeSandboxes);

describe("worker host", () => {
  beforeEach(() => {
    useBackend("worker");
  });

  it("accepts a worker path string", () => Effect.runPromise(acceptsAWorkerPathString));

  it("reports a missing worker file as a sandbox error", () =>
    Effect.runPromise(reportsAMissingWorkerFileAs));

  it("reports a failing wasm module as a sandbox error", () =>
    Effect.runPromise(reportsAFailingWasmModuleAs));

  it("ignores Node --watch notifications from the worker", () =>
    Effect.runPromise(ignoresNodeWatchNotificationsFromThe));

  it.each([
    [{ ok: true, type: "done", value: "1", writes: "null" }, "store writes are not an array"],
    [
      { ok: true, type: "done", value: "1", writes: "[1]" },
      "store writes contain a malformed entry",
    ],
    [
      { ok: true, type: "done", value: "1", writes: '[["k", "{"]]' },
      'store value for "k" is not valid JSON',
    ],
    [{ ok: true, type: "done", value: "{", writes: "[]" }, "return value is not valid JSON"],
    [{ error: "5", ok: false, type: "done" }, "script error is not an object"],
    [{ error: "{}", ok: false, type: "done" }, "script error is malformed"],
    [{ type: "nonsense" }, "unknown message from the worker"],
  ])("reports a broken bridge as a sandbox error: %j", (message, reason) =>
    Effect.runPromise(reportsABrokenBridge(message, reason)),
  );
});
