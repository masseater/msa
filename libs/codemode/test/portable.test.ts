import { Effect, Latch } from "effect";
import { describe, expect, it } from "vite-plus/test";

import codemode from "../src/index.ts";
import type codemodeTypes from "../src/index.types.ts";
import support from "./support.ts";

const { InlineCodemodeSandbox, RemoteCodemodeSandbox, loadQuickJSWasm, serveCodemodeRemote } =
  codemode;

const { abortController, hang, toJson } = support;

const wasm = loadQuickJSWasm();

function recordingRemote(options: Partial<codemodeTypes.CodemodeServeOptions> = {}) {
  const exchanges: number[] = [];
  const served: Promise<void>[] = [];
  const remote: codemodeTypes.CodemodeRemote = {
    execute(
      request: codemodeTypes.CodemodeRemoteRequest,
      exchange: codemodeTypes.CodemodeRemoteExchange,
    ) {
      const done = serveCodemodeRemote(
        structuredClone(request),
        (messages) => {
          exchanges.push(messages.length);
          return exchange(structuredClone(messages)).then((reply) => structuredClone(reply));
        },
        { wasm, ...options },
      );
      served.push(done);
      return done;
    },
  };
  return { exchanges, remote, served };
}

const failsAScriptThatComputesPast = Effect.gen(function* () {
  const sandbox = new InlineCodemodeSandbox({ interruptBudget: 1_000, wasm });
  for (const code of ["while (true) {}", "while (true) await null"]) {
    const result = yield* Effect.promise(() =>
      sandbox.execute(code, { timeoutMs: Number.POSITIVE_INFINITY }),
    );
    expect(result).toMatchObject({
      error: { kind: "timeout", message: "Execution exceeded its interrupt budget of 1000" },
      ok: false,
    });
  }
});

const countsTheBudgetAcrossWaitsOn = Effect.gen(function* () {
  const sandbox = new InlineCodemodeSandbox({
    interruptBudget: 1_000,
    tools: [{ execute: () => 1, name: "tick" }],
    wasm,
  });
  const result = yield* Effect.promise(() =>
    sandbox.execute("for (;;) { for (let i = 0; i < 1e5; i++); await tools.tick(); }"),
  );
  expect(result).toMatchObject({ error: { kind: "timeout" }, ok: false });
  expect(result.calls.length).toBeGreaterThan(1);
});

const runsToolsInTheCallerAnd = Effect.gen(function* () {
  const { remote, served } = recordingRemote();
  const seen: unknown[] = [];
  const sandbox = new RemoteCodemodeSandbox({
    remote: () => remote,
    tools: [
      {
        execute: (args) => {
          seen.push(args);
          return (args as { a: number }).a + 1;
        },
        name: "add",
      },
    ],
  });
  const result = yield* Effect.promise(() =>
    sandbox.execute("text('hi'); return await tools.add({ a: 1 })", {
      store: { k: 1 },
    }),
  );
  expect(result).toMatchObject({ ok: true, output: [{ text: "hi", type: "text" }], value: 2 });
  expect(seen).toEqual([{ a: 1 }]);
  expect(result.calls).toMatchObject([{ name: "add", status: "ok" }]);
  yield* Effect.promise(() => Promise.all(served));
});

const batchesOutputInsteadOfMakingOne = Effect.gen(function* () {
  const { remote, exchanges } = recordingRemote();
  const sandbox = new RemoteCodemodeSandbox({ remote: () => remote });
  const result = yield* Effect.promise(() =>
    sandbox.execute("for (let i = 0; i < 5000; i++) console.log(i); return 'ok'"),
  );
  expect(result).toMatchObject({ ok: true, value: "ok" });
  expect(result.output).toHaveLength(5000);
  expect(result.output[4999]).toEqual({ console: true, text: "4999", type: "text" });
  expect(exchanges.length).toBeLessThanOrEqual(6);
});

const capsTheInterruptBudgetAndMemory = Effect.gen(function* () {
  const { remote } = recordingRemote({
    maxInterruptBudget: 1_000,
    maxMemoryLimitBytes: 8 * 1024 * 1024,
  });
  const sandbox = new RemoteCodemodeSandbox({ interruptBudget: 1e9, remote: () => remote });
  expect(yield* Effect.promise(() => sandbox.execute("while (true) {}"))).toMatchObject({
    error: { kind: "timeout", message: "Execution exceeded its interrupt budget of 1000" },
    ok: false,
  });
  const memory = yield* Effect.promise(() =>
    sandbox.execute("const parts = []; for (;;) parts.push('x'.repeat(1 << 20) + parts.length);"),
  );
  expect(memory).toMatchObject({ ok: false });
  expect(yield* toJson(memory)).toContain("out of memory");
});

const tellsTheRemoteToStopWhen = Effect.gen(function* () {
  const { remote, served } = recordingRemote();
  const call = Latch.makeUnsafe(false);
  const sandbox = new RemoteCodemodeSandbox({
    remote: () => remote,
    tools: [
      {
        execute: () => {
          call.openUnsafe();
          return hang();
        },
        name: "hang",
      },
    ],
  });
  const controller = abortController();
  const pending = sandbox.execute("await tools.hang(); return 'never'", {
    signal: controller.signal,
  });
  yield* call.await;
  controller.abort();
  expect(yield* Effect.promise(() => pending)).toMatchObject({
    error: { kind: "aborted" },
    ok: false,
  });
  yield* Effect.promise(() => Promise.all(served));
});

const reportsAFailingOrVanishingRemote = Effect.gen(function* () {
  const failing = new RemoteCodemodeSandbox({
    remote: () => ({ execute: () => Promise.reject(new Error("object reset")) }),
  });
  expect(yield* Effect.promise(() => failing.execute("return 1"))).toMatchObject({
    error: { kind: "sandbox", message: "Remote sandbox failed: object reset" },
    ok: false,
  });

  const silent = new RemoteCodemodeSandbox({
    remote: () => ({ execute: () => Promise.resolve() }),
  });
  expect(yield* Effect.promise(() => silent.execute("return 1"))).toMatchObject({
    error: { kind: "sandbox", message: "Remote sandbox returned before the script settled" },
    ok: false,
  });

  const unreachable = new RemoteCodemodeSandbox({
    remote: () => {
      throw new Error("no binding");
    },
  });
  expect(yield* Effect.promise(() => unreachable.execute("return 1"))).toMatchObject({
    error: { kind: "sandbox", message: "Failed to reach the remote sandbox: no binding" },
    ok: false,
  });
});

describe("InlineCodemodeSandbox", () => {
  it("fails a script that computes past its interrupt budget as a timeout", () =>
    Effect.runPromise(failsAScriptThatComputesPast));

  it("counts the budget across waits on tools", () =>
    Effect.runPromise(countsTheBudgetAcrossWaitsOn));
});

describe("RemoteCodemodeSandbox", () => {
  it("runs tools in the caller and the script on the remote", () =>
    Effect.runPromise(runsToolsInTheCallerAnd));

  it("batches output instead of making one exchange per line", () =>
    Effect.runPromise(batchesOutputInsteadOfMakingOne));

  it("caps the interrupt budget and memory at the remote's limits", () =>
    Effect.runPromise(capsTheInterruptBudgetAndMemory));

  it("tells the remote to stop when the caller aborts", () =>
    Effect.runPromise(tellsTheRemoteToStopWhen));

  it("reports a failing or vanishing remote as a sandbox error", () =>
    Effect.runPromise(reportsAFailingOrVanishingRemote));
});
