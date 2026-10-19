import { Worker } from "node:worker_threads";

import * as codemode from "@msa/codemode";
import { abortController, awaited, deferredPromise, runTest } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { executeCodemode } from "../src/extensions/codemode/execute.ts";

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

describe("codemode worker admission", () => {
  it.each(["timeout", "abort", "success"] as const)("bounds surviving workers after %s", (how) =>
    runTest(
      Effect.gen(function* () {
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
                expect(
                  once.mock.calls.filter(([event]) => event === "exit").length,
                ).toBeGreaterThan(exitListenersBefore),
              ),
            );
            controller.abort();
          }
          const result = yield* awaited(pending);
          if (how === "success") expect(result.isError).toBeUndefined();
          else {
            expect(result.isError).toBe(true);
            expect(result.content).toContainEqual({
              type: "text" as const,
              text: expect.stringContaining(
                how === "timeout" ? "Script timed out:" : "Script aborted:",
              ),
            });
          }
          expect(terminations.size).toBe(i + 1);
        }

        const blocked = yield* awaited(run("return 3"));
        expect(blocked).toMatchObject({ isError: true, details: { calls: [] } });
        expect(blocked.content).toContainEqual({
          type: "text" as const,
          text: expect.stringContaining(
            "Codemode worker limit reached (2 workers are still running or shutting down)",
          ),
        });
        expect(terminations.size).toBe(2);

        const aborted = yield* awaited(run("while (true) {}", AbortSignal.abort()));
        expect(aborted.isError).toBe(true);
        expect(aborted.content).toContainEqual({
          type: "text" as const,
          text: expect.stringContaining("Script aborted:"),
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

  it("bounds workers that start after their results already timed out", () =>
    runTest(
      Effect.gen(function* () {
        const wasm = yield* awaited(codemode.loadQuickJSWasm());
        const loading = Promise.withResolvers<codemode.CodemodeWasmModule>();
        vi.spyOn(codemode, "loadQuickJSWasm").mockReturnValue(loading.promise);
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
            type: "text" as const,
            text: expect.stringContaining("Codemode worker limit reached"),
          });
          expect(terminations.size).toBe(2);
        } finally {
          loading.resolve(wasm);
        }
      }),
    ));

  it("admits only two workers from a concurrent burst", () =>
    runTest(
      Effect.gen(function* () {
        const results = yield* awaited(
          Promise.all(Array.from({ length: 6 }, () => run("return 1"))),
        );
        expect(results.filter((result) => !(result.isError === true))).toHaveLength(2);
        expect(results.filter((result) => result.isError)).toHaveLength(4);
        expect(terminations.size).toBe(2);
      }),
    ));
});
