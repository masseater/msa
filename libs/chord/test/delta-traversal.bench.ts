import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { Console, Effect, Exit } from "effect";

import { track } from "../src/delta/index.ts";
import { sha256Hex } from "../src/platform.ts";
import {
  collectGarbage,
  decodeJson,
  encodeJson,
  encodePrettyJson,
  nowIso,
} from "./fixtures/benchmark.ts";
import { readText, runNode, writeText } from "./fixtures/platform.ts";

type Point = { x: number; y: number; pressure: number };
type Drawing = { strokes: { id: number; color: string; width: number; points: Point[] }[] };
type Mode = "raw" | "proxy" | "delta";
const MiB = 1024 * 1024;
const gc = collectGarbage(4);

function fixture(strokes: number, points: number): Drawing {
  return {
    strokes: Array.from({ length: strokes }, (_stroke, id) => ({
      id,
      color: id % 2 === 1 ? "#405060" : "#102030",
      width: 2,
      points: Array.from({ length: points }, (_point, p) => ({
        x: p * 3 + (id % 127),
        y: p * 7 + (id % 131),
        pressure: (p % 10) / 10,
      })),
    })),
  };
}
function membrane<T extends object>(input: T): T {
  const cache = new WeakMap<object, object>();
  const wrap = (value: object): object => {
    const existing = cache.get(value);
    if (existing !== undefined) return existing;
    const proxy = new Proxy(value, {
      get(target, key, receiver) {
        const child: unknown = Reflect.get(target, key, receiver);
        return child !== null && typeof child === "object" ? wrap(child) : child;
      },
    });
    cache.set(value, proxy);
    return proxy;
  };
  return wrap(input) as T;
}
function setup(mode: Mode, input: Drawing): { state: Drawing; finish(): void } {
  if (mode === "delta") {
    const tracker = track(input);
    const change = tracker.beginChange();
    return {
      state: change.state,
      finish() {
        tracker.adopt(change.prepare());
      },
    };
  }
  return { state: mode === "proxy" ? membrane(input) : input, finish() {} };
}
function prepare(mode: Mode, strokes: number, points: number) {
  return setup(mode, fixture(strokes, points));
}
function argumentAfter(index: number, flag: string): string {
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}
function traverse(state: Drawing): number {
  let sum = 0;
  const strokes = state.strokes;
  for (let s = 0; s < strokes.length; s++) {
    const stroke = strokes[s];
    if (stroke === undefined) throw new Error(`Missing stroke ${s}`);
    const points = stroke.points;
    for (let p = 0; p < points.length; p++) {
      const point = points[p];
      if (point === undefined) throw new Error(`Missing point ${p} of stroke ${s}`);
      sum += point.x + point.y + point.pressure;
    }
  }
  return sum;
}
function warm(mode: Mode): void {
  const t = prepare(mode, 10, 10);
  for (let i = 0; i < 10; i++) traverse(t.state);
  t.finish();
}
const hashedSources = [
  "../src/delta/index.ts",
  "../src/delta/tracker.ts",
  "../src/delta/draft.ts",
  "../src/delta/diff.ts",
  "../src/delta/revision-validator.ts",
  "../src/delta/apply-immutable-trusted.ts",
  "./delta-traversal.bench.ts",
];
const sources: Effect.Effect<Record<string, string>> = Effect.map(
  Effect.forEach(hashedSources, (path) =>
    Effect.map(
      Effect.flatMap(readText(fileURLToPath(new URL(path, import.meta.url))), sha256Hex),
      (hash) => [path, hash] as const,
    ),
  ),
  Object.fromEntries,
);
const measure = (mode: Mode, strokes: number, points: number, trial: number) =>
  Effect.gen(function* () {
    warm(mode);
    yield* gc;
    const empty = process.memoryUsage().heapUsed;
    const t = prepare(mode, strokes, points);
    yield* gc;
    const ready = process.memoryUsage().heapUsed;
    const start = performance.now();
    const checksum = traverse(t.state);
    const coldMs = performance.now() - start;
    const afterColdBeforeGc = process.memoryUsage().heapUsed;
    yield* gc;
    const afterCold = process.memoryUsage().heapUsed;
    const warmMs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const begin = performance.now();
      const check = traverse(t.state);
      warmMs.push(performance.now() - begin);
      assert.equal(check, checksum);
    }
    let expected = 0;
    for (let s = 0; s < strokes; s++) {
      for (let p = 0; p < points; p++) expected += p * 10 + (s % 127) + (s % 131) + (p % 10) / 10;
    }
    assert.ok(Math.abs(expected - checksum) < Math.max(1, Math.abs(expected)) * 1e-9);
    yield* gc;
    const retained = process.memoryUsage().heapUsed;
    assert.equal(t.state.strokes.length, strokes);
    t.finish();
    return {
      mode,
      strokes,
      points,
      trial,
      coldMs,
      warmMs,
      checksum,
      readyMiB: (ready - empty) / MiB,
      afterColdMiB: (afterCold - empty) / MiB,
      retainedMiB: (retained - empty) / MiB,
      lazyProxyMiB: (afterCold - ready) / MiB,
      sampledColdPeakMiB: (afterColdBeforeGc - empty) / MiB,
      maxRssMiB: process.resourceUsage().maxRSS / 1024,
      sourceHashes: yield* sources,
    };
  });
type Measurement = Effect.Success<ReturnType<typeof measure>>;
type Config = { mode: Mode; strokes: number; points: number; trial: number };

const runWorker = Effect.gen(function* () {
  const c = (yield* decodeJson(process.argv.at(-1)!)) as Config;
  yield* Console.log(yield* encodeJson(yield* measure(c.mode, c.strokes, c.points, c.trial)));
});

const parseModes = (): Set<string> => {
  const modeIndex = process.argv.indexOf("--modes");
  const selected = new Set(
    modeIndex < 0 ? ["raw", "proxy", "delta"] : argumentAfter(modeIndex, "--modes").split(","),
  );
  for (const mode of selected)
    if (!["raw", "proxy", "delta"].includes(mode)) throw new Error(`unknown mode: ${mode}`);
  return selected;
};

interface Run {
  readonly output: string;
  readonly hashes: Record<string, string>;
  readonly results: Measurement[];
  readonly failures: unknown[];
}

const runTrial = (run: Run, config: Config) =>
  Effect.gen(function* () {
    assert.deepStrictEqual(yield* sources, run.hashes, "source changed during benchmark");
    const exit = yield* Effect.exit(
      runNode(
        [
          "--expose-gc",
          "--max-old-space-size=8192",
          fileURLToPath(import.meta.url),
          "--worker",
          yield* encodeJson(config),
        ],
        { timeout: 180000 },
      ),
    );
    assert.deepStrictEqual(yield* sources, run.hashes, "source changed during benchmark");
    const passed = Exit.isSuccess(exit) && exit.value.status === 0;
    if (passed) run.results.push((yield* decodeJson(exit.value.stdout)) as Measurement);
    else
      run.failures.push({
        config,
        error: Exit.isSuccess(exit) ? "" : String(exit.cause),
        stderr: Exit.isSuccess(exit) ? exit.value.stderr : "",
        stdout: Exit.isSuccess(exit) ? exit.value.stdout : "",
      });
    const report = {
      node: process.version,
      date: yield* nowIso,
      sourceHashes: run.hashes,
      results: run.results,
      failures: run.failures,
    };
    yield* writeText(run.output, yield* encodePrettyJson(report));
    yield* Console.log(`${config.trial} ${config.mode}: ${passed ? "ok" : "FAILED"}`);
  });

const runAll = Effect.gen(function* () {
  const quick = process.argv.includes("--quick");
  const outIndex = process.argv.indexOf("--out");
  const output = outIndex < 0 ? "/tmp/delta-traversal.json" : argumentAfter(outIndex, "--out");
  const selected = parseModes();
  const run: Run = { output, hashes: yield* sources, results: [], failures: [] };
  for (let trial = 0; trial < (quick ? 1 : 3); trial++) {
    const modes: Mode[] = trial % 2 === 1 ? ["delta", "proxy", "raw"] : ["raw", "proxy", "delta"];
    for (const mode of modes) {
      if (selected.has(mode))
        yield* runTrial(run, { mode, strokes: quick ? 200 : 20000, points: 100, trial });
    }
  }
  yield* Console.log(`Results: ${output}; failures: ${run.failures.length}`);
  if (run.failures.length > 0) process.exitCode = 1;
});

await Effect.runPromise(process.argv.includes("--worker") ? runWorker : runAll);
