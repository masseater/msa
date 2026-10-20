import { Worker } from "node:worker_threads";

import { Deferred, Effect, Latch } from "effect";
import { type MockInstance, afterEach, describe, expect, it, vi } from "vite-plus/test";

import codemode from "../src/index.ts";
import type codemodeTypes from "../src/index.types.ts";
import support from "./support.ts";

const { CodemodeSandbox } = codemode;

const { abortController, hang } = support;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const doesNotStartAWorkerWhen = Effect.gen(function* () {
  const onWorkerStarted = vi.fn();
  const acquireWorker = vi.fn(() => {
    throw new Error("worker capacity exhausted");
  });
  const sandbox = new CodemodeSandbox({ acquireWorker, onWorkerStarted });
  try {
    expect(yield* Effect.promise(() => sandbox.execute("while (true) {}"))).toMatchObject({
      error: { kind: "sandbox", message: "worker capacity exhausted" },
      ok: false,
    });
    expect(acquireWorker).toHaveBeenCalledTimes(1);
    expect(onWorkerStarted).not.toHaveBeenCalled();
  } finally {
    yield* Effect.promise(() => sandbox.close());
  }
});

const releasesAdmissionWhenWorkerConstructionFails = Effect.gen(function* () {
  const releaseWorker = vi.fn();
  const acquireWorker = vi.fn(() => releaseWorker);
  const sandbox = new CodemodeSandbox({
    acquireWorker,
    workerUrl: new URL("https://invalid.example/worker.js"),
  });
  try {
    expect(yield* Effect.promise(() => sandbox.execute("return 1"))).toMatchObject({
      error: { kind: "sandbox", message: expect.stringContaining("Failed to start worker:") },
      ok: false,
    });
    expect(acquireWorker).toHaveBeenCalledTimes(1);
    expect(releaseWorker).toHaveBeenCalledTimes(1);
  } finally {
    yield* Effect.promise(() => sandbox.close());
  }
});

const doesNotAcquireAdmissionWhenWasm = Effect.gen(function* () {
  const acquireWorker = vi.fn(() => vi.fn());
  const sandbox = new CodemodeSandbox({
    acquireWorker,
    wasm: Promise.reject(new Error("wasm unavailable")),
  });
  try {
    expect(yield* Effect.promise(() => sandbox.execute("return 1"))).toMatchObject({
      error: { kind: "sandbox", message: "Failed to load QuickJS: wasm unavailable" },
      ok: false,
    });
    expect(acquireWorker).not.toHaveBeenCalled();
  } finally {
    yield* Effect.promise(() => sandbox.close());
  }
});

const reportsTheActualExitOfExecute = Effect.gen(function* () {
  const exits: Promise<void>[] = [];
  const releaseWorker = vi.fn();
  const acquireWorker = vi.fn(() => releaseWorker);
  const sandbox = new CodemodeSandbox({
    acquireWorker,
    onWorkerStarted: (exited) => void exits.push(exited),
  });
  try {
    expect(yield* Effect.promise(() => sandbox.execute("return 1"))).toMatchObject({
      ok: true,
      value: 1,
    });
    const run = sandbox.start("return 2", { onCall: () => {}, seed: 0, startedAt: 0 });
    expect(yield* Effect.promise(() => run.result)).toMatchObject({ ok: true, value: 2 });
    expect(run.finished).toBe(true);
    expect(exits).toHaveLength(2);
    yield* Effect.promise(() => Promise.all(exits));
    expect(acquireWorker).toHaveBeenCalledTimes(2);
    expect(releaseWorker).toHaveBeenCalledTimes(2);
  } finally {
    yield* Effect.promise(() => sandbox.close());
  }
});

const requestsTerminationWhenOnworkerstartedThrows = Effect.gen(function* () {
  let exited: Promise<void> | undefined;
  const releaseWorker = vi.fn();
  const sandbox = new CodemodeSandbox({
    acquireWorker: () => releaseWorker,
    onWorkerStarted: (promise) => {
      exited = promise;
      throw new Error("lifetime hook failed");
    },
  });
  try {
    expect(yield* Effect.promise(() => sandbox.execute("while (true) {}"))).toMatchObject({
      error: { kind: "sandbox", message: "lifetime hook failed" },
      ok: false,
    });
    const started = exited;
    expect(started).toBeDefined();
    yield* Effect.promise(() => started ?? Promise.resolve());
    expect(releaseWorker).toHaveBeenCalledTimes(1);
  } finally {
    yield* Effect.promise(() => sandbox.close());
  }
});

type StopMode = "abort" | "timeout" | "close";

interface Observed {
  toolSignal: AbortSignal | undefined;
  exited: Promise<void> | undefined;
  didExit: boolean;
  result: codemodeTypes.CodemodeResult | undefined;
  didClose: boolean;
}

function newObserved(): Observed {
  return {
    didClose: false,
    didExit: false,
    exited: undefined,
    result: undefined,
    toolSignal: undefined,
  };
}

function spyOnTermination() {
  const terminate = Worker.prototype.terminate;
  const termination = Deferred.makeUnsafe<number>();
  const spied: { worker: Worker | undefined } = { worker: undefined };
  const spy = vi.spyOn(Worker.prototype, "terminate").mockImplementation(function (this: Worker) {
    spied.worker = this;
    this.ref();
    return Effect.runPromise(Deferred.await(termination));
  });
  const release = Effect.suspend(() => {
    const { worker } = spied;
    if (worker === undefined) return Effect.void;
    return Effect.promise(() => terminate.call(worker)).pipe(
      Effect.flatMap((code) => Deferred.succeed(termination, code)),
    );
  });
  return { release, spied, spy };
}

function hangingSandbox(observed: Observed, called: Latch.Latch): codemodeTypes.CodemodeSandbox {
  return new CodemodeSandbox({
    onWorkerStarted: (promise) => {
      observed.exited = promise;
      void promise.then(() => {
        observed.didExit = true;
        return observed.didExit;
      });
    },
    timeoutMs: 100,
    tools: [
      {
        execute: (_args, { signal }) => {
          observed.toolSignal = signal;
          called.openUnsafe();
          return hang();
        },
        name: "hang",
      },
    ],
  });
}

const stop = Effect.fn(function* (
  how: StopMode,
  sandbox: codemodeTypes.CodemodeSandbox,
  controller: AbortController,
  observed: Observed,
) {
  if (how === "abort") controller.abort(new Error("cancelled"));
  if (how === "timeout") yield* Effect.promise(() => vi.advanceTimersByTimeAsync(100));
  if (how === "close") {
    void sandbox.close().then(() => {
      observed.didClose = true;
      return observed.didClose;
    });
  }
});

interface WorkerSpies {
  readonly terminate: MockInstance;
  readonly ref: MockInstance;
  readonly unref: MockInstance;
}

function expectSettledEarly(how: StopMode, observed: Observed, spies: WorkerSpies): void {
  expect(observed.result).toMatchObject({
    calls: [{ name: "hang", status: "cancelled" }],
    error: { kind: how === "timeout" ? "timeout" : "aborted" },
    ok: false,
    output: [{ text: "partial", type: "text" }],
  });
  expect(observed.toolSignal?.aborted).toBe(true);
  expect(spies.terminate).toHaveBeenCalledTimes(1);
  expect(spies.unref).toHaveBeenCalledTimes(1);
  expect(spies.ref).toHaveBeenCalledTimes(1);
  const [refOrder] = spies.ref.mock.invocationCallOrder;
  if (refOrder === undefined) throw new Error("Expected ref() to be called");
  expect(spies.unref.mock.invocationCallOrder[0]).toBeGreaterThan(refOrder);
  expect(observed.exited).toBeDefined();
  expect(observed.didExit).toBe(false);
  if (how === "close") expect(observed.didClose).toBe(true);
}

const settlesWithoutWaitingForExit = Effect.fn(function* (how: StopMode) {
  vi.useFakeTimers();
  const termination = spyOnTermination();
  const spies = {
    ref: vi.spyOn(Worker.prototype, "ref"),
    terminate: termination.spy,
    unref: vi.spyOn(Worker.prototype, "unref"),
  };
  const called = Latch.makeUnsafe(false);
  const observed = newObserved();
  const sandbox = hangingSandbox(observed, called);
  const controller = abortController();
  const pending = sandbox.execute('text("partial"); await tools.hang()', {
    signal: controller.signal,
  });
  void pending.then((value) => {
    observed.result = value;
    return value;
  });
  yield* Effect.gen(function* () {
    yield* called.await;
    yield* stop(how, sandbox, controller, observed);
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
    expectSettledEarly(how, observed, spies);
    yield* Effect.promise(() => sandbox.close());
    termination.spied.worker?.emit("message", {
      ok: true,
      type: "done",
      value: "42",
      writes: "[]",
    });
    expect(yield* Effect.promise(() => pending)).toBe(observed.result);
    expect(termination.spy).toHaveBeenCalledTimes(1);
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        vi.useRealTimers();
        termination.spy.mockRestore();
        yield* termination.release;
        yield* Effect.promise(() => sandbox.close());
      }),
    ),
  );
  yield* Effect.promise(() => observed.exited ?? Promise.resolve());
  expect(observed.didExit).toBe(true);
});

describe("worker lifetime", () => {
  it("does not start a worker when admission is denied", () =>
    Effect.runPromise(doesNotStartAWorkerWhen));

  it("releases admission when worker construction fails", () =>
    Effect.runPromise(releasesAdmissionWhenWorkerConstructionFails));

  it("does not acquire admission when wasm loading fails", () =>
    Effect.runPromise(doesNotAcquireAdmissionWhenWasm));

  it.each(["abort", "timeout", "close"] as const)(
    "settles %s without waiting for worker exit",
    (how) => Effect.runPromise(settlesWithoutWaitingForExit(how)),
  );

  it("reports the actual exit of execute() and start() workers", () =>
    Effect.runPromise(reportsTheActualExitOfExecute));

  it("requests termination when onWorkerStarted throws", () =>
    Effect.runPromise(requestsTerminationWhenOnworkerstartedThrows));
});
