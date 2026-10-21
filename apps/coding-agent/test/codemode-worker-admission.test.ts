import { Worker } from "node:worker_threads";

import codemodeModule from "@msa/codemode";
import type codemodeTypes from "@msa/codemode/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import execute from "../src/extensions/codemode/execute.ts";

const { executeCodemode } = execute;

const { abortController, awaited, deferredPromise, runTest } = testing;

const terminate = Worker.prototype.terminate;
const terminations = new Map<Worker, (code: number) => void>();

beforeEach(() => {
  vi.spyOn(Worker.prototype, "terminate").mockImplementation(function (this: Worker) {
    this.ref();
    const deferred = deferredPromise<number>();
    terminations.set(this, deferred.resolve);
    return deferred.promise;
  });
});

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      vi.restoreAllMocks();
      yield* awaited(
        Promise.all(
          [...terminations].map(([worker, resolve]) =>
            effectRunPromise(
              Effect.gen(function* () {
                resolve(yield* awaited(terminate.call(worker)));
              }),
            ),
          ),
        ),
      );
      terminations.clear();
    }),
  ),
);

const run = (code: string, signal?: AbortSignal) =>
  executeCodemode("worker-admission", { code }, signal, undefined, undefined);

const boundsWorkersThatStartAfterTheirResults = () =>
  runTest(
    Effect.gen(function* () {
      const wasm = yield* awaited(codemodeModule.loadQuickJSWasm());
      const loading = Promise.withResolvers<codemodeTypes.CodemodeWasmModule>();
      vi.spyOn(codemodeModule, "loadQuickJSWasm").mockReturnValue(loading.promise);
      try {
        const results = yield* awaited(
          Promise.all(
            Array.from({ length: 3 }, () =>
              run('// @options: {"timeout_ms": 20}\nwhile (true) {}'),
            ),
          ),
        );
        expect(results.every((result) => result.isError)).toBe(true);
        expect(terminations.size).toBe(0);
        loading.resolve(wasm);
        const blocked = yield* awaited(run("return 1"));
        expect(blocked.isError).toBe(true);
        expect(blocked.content).toContainEqual({
          text: expect.stringContaining("Codemode worker limit reached"),
          type: "text" as const,
        });
        expect(terminations.size).toBe(2);
      } finally {
        loading.resolve(wasm);
      }
    }),
  );

const admitsOnlyTwoWorkersFromAConcurrent = () =>
  runTest(
    Effect.gen(function* () {
      const results = yield* awaited(Promise.all(Array.from({ length: 6 }, () => run("return 1"))));
      expect(results.filter((result) => !(result.isError === true))).toHaveLength(2);
      expect(results.filter((result) => result.isError)).toHaveLength(4);
      expect(terminations.size).toBe(2);
    }),
  );

const expectBoundedWorkers = (input: { readonly how: "timeout" | "abort" | "success" }) =>
  Effect.gen(function* () {
    const { how } = input;
    const once = vi.spyOn(Worker.prototype, "once");
    for (let i = 0; i < 2; i++) {
      const controller = abortController();
      const exitListenersBefore = once.mock.calls.filter(([event]) => event === "exit").length;
      const pending = run(
        how === "timeout"
          ? '// @options: {"timeout_ms": 200}\nwhile (true) {}'
          : how === "abort"
            ? "while (true) {}"
            : "return 1",
        controller.signal,
      );
      if (how === "abort") {
        yield* awaited(
          vi.waitFor(() =>
            expect(once.mock.calls.filter(([event]) => event === "exit").length).toBeGreaterThan(
              exitListenersBefore,
            ),
          ),
        );
        controller.abort();
      }
      const result = yield* awaited(pending);
      if (how === "success") expect(result.isError).toBeUndefined();
      else {
        expect(result.isError).toBe(true);
        expect(result.content).toContainEqual({
          text: expect.stringContaining(
            how === "timeout" ? "Script timed out:" : "Script aborted:",
          ),
          type: "text" as const,
        });
      }
      expect(terminations.size).toBe(i + 1);
    }
  });

describe("codemode worker admission", () => {
  it.each(["timeout", "abort", "success"] as const)("bounds surviving workers after %s", (how) =>
    runTest(
      Effect.gen(function* () {
        yield* expectBoundedWorkers({ how });

        const blocked = yield* awaited(run("return 3"));
        expect(blocked).toMatchObject({ details: { calls: [] }, isError: true });
        expect(blocked.content).toContainEqual({
          text: expect.stringContaining(
            "Codemode worker limit reached (2 workers are still running or shutting down)",
          ),
          type: "text" as const,
        });
        expect(terminations.size).toBe(2);

        const aborted = yield* awaited(run("while (true) {}", AbortSignal.abort()));
        expect(aborted.isError).toBe(true);
        expect(aborted.content).toContainEqual({
          text: expect.stringContaining("Script aborted:"),
          type: "text" as const,
        });
        expect(terminations.size).toBe(2);

        const [termination] = terminations;
        if (termination === undefined) throw new Error("expected a pending worker termination");
        const [worker, resolve] = termination;
        resolve(yield* awaited(terminate.call(worker)));
        terminations.delete(worker);
        expect((yield* awaited(run("return 42"))).isError).toBeUndefined();
        expect(terminations.size).toBe(2);
      }),
    ),
  );
});

describe("codemode worker admission", () => {
  it(
    "bounds workers that start after their results already timed out",
    boundsWorkersThatStartAfterTheirResults,
  );

  it("admits only two workers from a concurrent burst", admitsOnlyTwoWorkersFromAConcurrent);
});
