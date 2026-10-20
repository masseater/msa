import { Effect, Latch } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import codemode from "../src/index.ts";
import sandboxSupport from "./sandbox-support.ts";
import support from "./support.ts";

const { MAX_OUTPUT_CHARS, MAX_OUTPUT_ITEMS } = codemode;

const { closeSandboxes, createSandbox, delayed, describeBackends } = sandboxSupport;
const { abortController, hang } = support;

const terminatesASynchronousInfiniteLoopOn = Effect.gen(function* () {
  const sandbox = createSandbox();
  const started = performance.now();
  const result = yield* Effect.promise(() =>
    sandbox.execute("while (true) {}", { timeoutMs: 200 }),
  );
  expect(result).toMatchObject({ error: { kind: "timeout" }, ok: false });
  expect(performance.now() - started).toBeLessThan(5_000);
});

const runsWithoutADeadlineWhenTimeoutms = Effect.gen(function* () {
  const sandbox = createSandbox([{ execute: () => delayed(50, "late"), name: "wait" }]);
  const result = yield* Effect.promise(() =>
    sandbox.execute("return await tools.wait()", {
      timeoutMs: Number.POSITIVE_INFINITY,
    }),
  );
  expect(result).toMatchObject({ ok: true, value: "late" });
});

const failsAScriptThatWaitsOn = Effect.gen(function* () {
  const sandbox = createSandbox([{ execute: (args) => args, name: "echo" }]);
  const result = yield* Effect.promise(() =>
    sandbox.execute("await tools.echo(1); await new Promise(() => {}); return 'never'", {
      timeoutMs: Number.POSITIVE_INFINITY,
    }),
  );
  expect(result).toMatchObject({
    error: { kind: "script", message: expect.stringContaining("can never settle") },
    ok: false,
  });
  const returned = yield* Effect.promise(() =>
    sandbox.execute("tools.echo(2); return 'early'", {
      timeoutMs: Number.POSITIVE_INFINITY,
    }),
  );
  expect(returned).toMatchObject({ ok: true, value: "early" });
});

const terminatesAMicrotaskSpinningLoopOn = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute("while (true) await null", { timeoutMs: 200 }),
  );
  expect(result).toMatchObject({ error: { kind: "timeout" }, ok: false });
});

const abortsViaSignalAndCancelsIn = Effect.gen(function* () {
  const controller = abortController();
  let toolSignal: AbortSignal | undefined;
  let call = Latch.makeUnsafe(false);
  const sandbox = createSandbox([
    {
      execute: (_args, { signal }) => {
        toolSignal = signal;
        call.openUnsafe();
        return hang();
      },
      name: "hang",
    },
  ]);
  const firstCall = call;
  const promise = sandbox.execute("await tools.hang(); return 'never'");
  yield* firstCall.await;
  controller.abort(new Error("user cancelled"));
  expect(toolSignal?.aborted).toBe(false);
  const result = yield* Effect.promise(() =>
    sandbox.execute("await tools.hang()", { signal: controller.signal }),
  );
  expect(result).toMatchObject({
    error: { kind: "aborted", message: "user cancelled" },
    ok: false,
  });

  const second = abortController();
  call = Latch.makeUnsafe(false);
  const secondCall = call;
  const pending = sandbox.execute("await tools.hang(); return 'never'", {
    signal: second.signal,
  });
  yield* secondCall.await;
  second.abort();
  const aborted = yield* Effect.promise(() => pending);
  expect(aborted).toMatchObject({ error: { kind: "aborted" }, ok: false });
  expect(aborted.calls).toMatchObject([{ name: "hang", status: "cancelled" }]);
  expect(toolSignal?.aborted).toBe(true);

  yield* Effect.promise(() => sandbox.close());
  expect(yield* Effect.promise(() => promise)).toMatchObject({
    error: { kind: "aborted", message: "Sandbox closed" },
    ok: false,
  });
});

const failsAScriptWhoseOutputPasses = Effect.gen(function* () {
  const sandbox = createSandbox();
  for (const print of ["text(s)", "console.log(s)", 'image("data:image/png;base64," + p)']) {
    const result = yield* Effect.promise(() =>
      sandbox.execute(`
					const s = "x".repeat(1 << 20);
					const p = "iVBORw0KGgoA" + "A".repeat(1 << 20);
					for (;;) { try { ${print}; } catch {} }
				`),
    );
    expect(result).toMatchObject({
      error: {
        kind: "script",
        message: expect.stringContaining("script output exceeded"),
        name: "RangeError",
      },
      ok: false,
    });
    const chars = result.output.reduce(
      (sum, item) => sum + (item.type === "text" ? item.text.length : item.data.length),
      0,
    );
    expect(chars).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(chars).toBeGreaterThan(MAX_OUTPUT_CHARS - (2 << 20));
  }

  const empty = yield* Effect.promise(() => sandbox.execute(`for (;;) text("");`));
  expect(empty).toMatchObject({ error: { name: "RangeError" }, ok: false });
  expect(empty.output).toHaveLength(MAX_OUTPUT_ITEMS);
});

const rejectsExecuteAfterClose = Effect.gen(function* () {
  const sandbox = createSandbox();
  yield* Effect.promise(() => sandbox.close());
  yield* Effect.promise(() => expect(sandbox.execute("return 1")).rejects.toThrow(/closed/u));
});

const runsExecutionsInParallelWithoutSharing = Effect.gen(function* () {
  const sandbox = createSandbox();
  const results = yield* Effect.promise(() =>
    Promise.all([
      sandbox.execute("globalThis.shared = 'a'; await null; return globalThis.shared"),
      sandbox.execute("globalThis.shared = 'b'; await null; return globalThis.shared"),
      sandbox.execute("return typeof globalThis.shared"),
    ]),
  );
  expect(results.map((result) => (result.ok ? result.value : result.error))).toEqual([
    "a",
    "b",
    "undefined",
  ]);
});

const turnsDeepRecursionIntoACatchable = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				let depth = 0;
				function dive() { depth++; dive(); }
				try { dive(); } catch (error) { return [error.name, depth > 1000]; }
			`),
  );
  expect(result).toMatchObject({ ok: true, value: ["RangeError", true] });
});

afterEach(closeSandboxes);

describeBackends("limits and lifetime", () => {
  it("terminates a synchronous infinite loop on timeout", () =>
    Effect.runPromise(terminatesASynchronousInfiniteLoopOn));

  it("runs without a deadline when timeoutMs is Infinity", () =>
    Effect.runPromise(runsWithoutADeadlineWhenTimeoutms));

  it("fails a script that waits on a promise nothing can settle", () =>
    Effect.runPromise(failsAScriptThatWaitsOn));

  it("terminates a microtask-spinning loop on timeout", () =>
    Effect.runPromise(terminatesAMicrotaskSpinningLoopOn));

  it("aborts via signal and cancels in-flight calls", () =>
    Effect.runPromise(abortsViaSignalAndCancelsIn));

  it(
    "fails a script whose output passes the limits, even if it catches the error",
    () => Effect.runPromise(failsAScriptWhoseOutputPasses),
    20_000,
  );

  it("rejects execute after close", () => Effect.runPromise(rejectsExecuteAfterClose));

  it("runs executions in parallel without sharing state", () =>
    Effect.runPromise(runsExecutionsInParallelWithoutSharing));

  it("turns deep recursion into a catchable RangeError", () =>
    Effect.runPromise(turnsDeepRecursionIntoACatchable));
});
