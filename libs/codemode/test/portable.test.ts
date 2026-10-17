import { Effect, Latch } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  type CodemodeRemote,
  type CodemodeRemoteExchange,
  type CodemodeRemoteRequest,
  type CodemodeServeOptions,
  InlineCodemodeSandbox,
  loadQuickJSWasm,
  RemoteCodemodeSandbox,
  serveCodemodeRemote,
} from "../src/index.ts";
import { abortController, hang, toJson } from "./support.ts";

const wasm = loadQuickJSWasm();

function recordingRemote(options: Partial<CodemodeServeOptions> = {}) {
  const exchanges: number[] = [];
  const served: Promise<void>[] = [];
  const remote: CodemodeRemote = {
    execute(request: CodemodeRemoteRequest, exchange: CodemodeRemoteExchange) {
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
  return { remote, exchanges, served };
}

const failsAScriptThatComputesPast = Effect.gen(function* () {
  const sandbox = new InlineCodemodeSandbox({ wasm, interruptBudget: 1_000 });
  for (const code of ["while (true) {}", "while (true) await null"]) {
    const result = yield* Effect.promise(() =>
      sandbox.execute(code, { timeoutMs: Number.POSITIVE_INFINITY }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "timeout", message: "Execution exceeded its interrupt budget of 1000" },
    });
  }
});

const countsTheBudgetAcrossWaitsOn = Effect.gen(function* () {
  const sandbox = new InlineCodemodeSandbox({
    wasm,
    interruptBudget: 1_000,
    tools: [{ name: "tick", execute: () => 1 }],
  });
  const result = yield* Effect.promise(() =>
    sandbox.execute("for (;;) { for (let i = 0; i < 1e5; i++); await tools.tick(); }"),
  );
  expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
  expect(result.calls.length).toBeGreaterThan(1);
});

const runsToolsInTheCallerAnd = Effect.gen(function* () {
  const { remote, served } = recordingRemote();
  const seen: unknown[] = [];
  const sandbox = new RemoteCodemodeSandbox({
    remote: () => remote,
    tools: [
      {
        name: "add",
        execute: (args) => {
          seen.push(args);
          return (args as { a: number }).a + 1;
        },
      },
    ],
  });
  const result = yield* Effect.promise(() =>
    sandbox.execute("text('hi'); return await tools.add({ a: 1 })", {
      store: { k: 1 },
    }),
  );
  expect(result).toMatchObject({ ok: true, value: 2, output: [{ type: "text", text: "hi" }] });
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
  expect(result.output[4999]).toEqual({ type: "text", text: "4999", console: true });
  expect(exchanges.length).toBeLessThanOrEqual(6);
});

const capsTheInterruptBudgetAndMemory = Effect.gen(function* () {
  const { remote } = recordingRemote({
    maxInterruptBudget: 1_000,
    maxMemoryLimitBytes: 8 * 1024 * 1024,
  });
  const sandbox = new RemoteCodemodeSandbox({ remote: () => remote, interruptBudget: 1e9 });
  expect(yield* Effect.promise(() => sandbox.execute("while (true) {}"))).toMatchObject({
    ok: false,
    error: { kind: "timeout", message: "Execution exceeded its interrupt budget of 1000" },
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
        name: "hang",
        execute: () => {
          call.openUnsafe();
          return hang();
        },
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
    ok: false,
    error: { kind: "aborted" },
  });
  yield* Effect.promise(() => Promise.all(served));
});

const reportsAFailingOrVanishingRemote = Effect.gen(function* () {
  const failing = new RemoteCodemodeSandbox({
    remote: () => ({ execute: () => Promise.reject(new Error("object reset")) }),
  });
  expect(yield* Effect.promise(() => failing.execute("return 1"))).toMatchObject({
    ok: false,
    error: { kind: "sandbox", message: "Remote sandbox failed: object reset" },
  });

  const silent = new RemoteCodemodeSandbox({
    remote: () => ({ execute: () => Promise.resolve() }),
  });
  expect(yield* Effect.promise(() => silent.execute("return 1"))).toMatchObject({
    ok: false,
    error: { kind: "sandbox", message: "Remote sandbox returned before the script settled" },
  });

  const unreachable = new RemoteCodemodeSandbox({
    remote: () => {
      throw new Error("no binding");
    },
  });
  expect(yield* Effect.promise(() => unreachable.execute("return 1"))).toMatchObject({
    ok: false,
    error: { kind: "sandbox", message: "Failed to reach the remote sandbox: no binding" },
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
