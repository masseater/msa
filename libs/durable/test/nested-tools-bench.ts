import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai/providers/faux";
import { Console, Effect, Fiber } from "effect";
import { Type } from "typebox";

import { Harness, createRegistry } from "../src/harness/index.ts";
import {
  type Conversation,
  type StorageWrite,
  ToolResultEntry,
  defineExtension,
  defineTool,
} from "../src/index.ts";
import benchSupport from "./bench-support.ts";
import type benchSupportTypes from "./bench-support.types.ts";
import support from "./support.ts";

const { directorySize, heapAfterGc, meterCommits, noWrites, openBenchStorage, requireGc } =
  benchSupport;
const { awaited, context, makeTempDir, removeDir, sampleEvery } = support;

type Written = Record<StorageWrite["type"], number>;

type Scenario = {
  backend: benchSupportTypes.Backend;
  calls: number;
  depth: 1 | 2;
  bytes: number;
  gapMs: number;
  progress: boolean;
  runs: number;
};
type Run = {
  commits: number;
  written: Written;
  storedBytes: number;
  ms: number;
  peakHeap: number;
  heldHeap: number;
};

requireGc();

const CHUNKS = 8;
const FAN_OUT = 10;

function blobTool(scenario: Scenario) {
  const chunk = `${"x".repeat(scenario.bytes / CHUNKS - 1)}\n`;
  return defineTool({
    description: "Stream a blob",
    execute: (_args, api) =>
      Effect.runPromise(
        Effect.gen(function* () {
          for (const _ of Array.from({ length: CHUNKS })) {
            api.output(chunk);
            yield* Effect.sleep(scenario.gapMs);
          }
          return {};
        }),
      ),
    name: "blob",
    parameters: Type.Object({ n: Type.Number() }),
  });
}

function fanOut(name: string, target: string, options: { readonly progress?: false }) {
  return defineTool({
    description: `Call ${target} in parallel`,
    execute: (args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const calls = Array.from({ length: args.count }, (_, n) =>
            api.executeTool(target, { count: FAN_OUT, n }, callContext, options),
          );
          const failed = (yield* awaited(Promise.all(calls))).filter(
            (result) => result.isError,
          ).length;
          return { isError: failed > 0, output: [{ text: `${failed} failed`, type: "text" }] };
        }),
      ),
    name,
    parameters: Type.Object({ count: Type.Number() }),
  });
}

function benchRegistry(scenario: Scenario) {
  const registry = createRegistry();
  const options = scenario.progress ? {} : { progress: false as const };
  registry.install(
    defineExtension({
      name: "bench",
      tools: [blobTool(scenario), fanOut("fan", "blob", options), fanOut("fan2", "fan", options)],
    }),
  );
  return registry;
}

type Meter = { commits: number; readonly written: Written };

const openMetered = Effect.fn("openMetered")(function* (scenario: Scenario, directory: string) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = benchRegistry(scenario);

  const storage = yield* awaited(openBenchStorage(scenario.backend, directory));
  const meter: Meter = { commits: 0, written: noWrites() };
  meterCommits(storage, meter);
  const harness = yield* awaited(Harness.open(storage, { models, registry }, context));
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );
  return { faux, harness, meter, root };
});

const measureRun = Effect.fn("measureRun")(function* (
  scenario: Scenario,
  directory: string,
  { faux, meter, harness, root }: Effect.Success<ReturnType<typeof openMetered>>,
  { run, baseHeap }: { readonly run: number; readonly baseHeap: number },
) {
  const top = scenario.depth === 1 ? scenario.calls : scenario.calls / FAN_OUT;
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall(scenario.depth === 1 ? "fan" : "fan2", { count: top }, { id: `r${run}` })],
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const before = { commits: meter.commits, written: { ...meter.written } };
  const heap = { peak: 0 };
  const sampler = yield* sampleEvery(5, () => {
    heap.peak = Math.max(heap.peak, process.memoryUsage().heapUsed);
  });
  const started = performance.now();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: `run ${run}`, type: "input" }, context))).wait(context),
  );
  if (settled.status !== "done") throw new Error(`run ${run}: ${settled.status}`);
  yield* assertToolsSucceeded(root, run);
  yield* awaited(harness.waitForIdle(context));
  const ms = Math.round(performance.now() - started);
  yield* Fiber.interrupt(sampler);
  const delta = noWrites();
  for (const type of Object.keys(delta) as StorageWrite["type"][]) {
    delta[type] = meter.written[type] - before.written[type];
  }
  return {
    commits: meter.commits - before.commits,
    heldHeap: heapAfterGc() - baseHeap,
    ms,
    peakHeap: heap.peak - baseHeap,
    storedBytes: yield* directorySize(directory),
    written: delta,
  };
});

const runScenario = Effect.fn("runScenario")(function* (scenario: Scenario) {
  const directory = yield* makeTempDir("msa-durable-nested-bench-");
  return yield* Effect.gen(function* () {
    const opened = yield* openMetered(scenario, directory);
    const perRun: Run[] = [];
    const baseHeap = heapAfterGc();
    for (const run of Array.from({ length: scenario.runs }, (_, i) => i)) {
      perRun.push(yield* measureRun(scenario, directory, opened, { baseHeap, run }));
    }
    yield* awaited(opened.harness.close(context));
    return { closedBytes: yield* directorySize(directory), perRun };
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => removeDir(directory)))));
});

const assertToolsSucceeded = Effect.fn("assertToolsSucceeded")(function* (
  root: Conversation,
  run: number,
) {
  const page = yield* awaited(root.entries({}, 10, undefined, context));
  const result = page.items.find((entry) => ToolResultEntry.is(entry))?.model?.[0];
  if (result?.role !== "toolResult" || result.isError)
    throw new Error(`run ${run}: a nested call failed`);
});

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

const report = Effect.fn("report")(function* (title: string, scenarios: Scenario[]) {
  yield* Console.log(`\n${title}`);
  yield* Console.log(
    "backend | calls | depth | output | gap   | stream | run 1: commits, ms, written (all; tasks / doc changes / doc creates) | stored after run 1 / 2 / 3 | after close | heap: run 1 peak; held after run 1 / 2 / 3",
  );
  for (const scenario of scenarios) {
    const { perRun, closedBytes } = yield* runScenario(scenario);
    const first = perRun[0]!;
    const all = Object.values(first.written).reduce((sum, bytes) => sum + bytes, 0);
    yield* Console.log(
      [
        scenario.backend.padEnd(6),
        String(scenario.calls).padEnd(5),
        String(scenario.depth).padEnd(5),
        `${scenario.bytes / 1024} KiB`.padEnd(6),
        `${scenario.gapMs} ms`.padEnd(5),
        (scenario.progress ? "yes" : "no").padEnd(6),
        `${first.commits}, ${first.ms} ms, ${mib(all)} (${mib(first.written.task)} / ${mib(first.written["document.change"])} / ${mib(first.written["document.create"])})`,
        perRun.map((run) => mib(run.storedBytes)).join(" / "),
        mib(closedBytes),
        `${mib(first.peakHeap)}; ${perRun.map((run) => mib(run.heldHeap)).join(" / ")}`,
      ].join(" | "),
    );
  }
});

function streamingScenarios(): Scenario[] {
  return (["sqlite", "jsonl"] as const).flatMap((backend) =>
    [1024, 16 * 1024].flatMap((bytes) =>
      [2, 50].flatMap((gapMs) =>
        [true, false].map((progress) => ({
          backend,
          bytes,
          calls: 200,
          depth: 1 as const,
          gapMs,
          progress,
          runs: 3,
        })),
      ),
    ),
  );
}

function nestingScenarios(): Scenario[] {
  return (["sqlite", "jsonl"] as const).flatMap((backend) =>
    [200, 2000].flatMap((calls) =>
      ([1, 2] as const).map((depth) => ({
        backend,
        bytes: 1024,
        calls,
        depth,
        gapMs: 2,
        progress: false,
        runs: 3,
      })),
    ),
  );
}

const main = Effect.fn("main")(function* () {
  const section = process.argv[2];
  if (section === undefined || section === "streaming") {
    yield* report("Streaming: 200 calls, with and without progress", streamingScenarios());
  }
  if (section === undefined || section === "nesting") {
    yield* report("Nesting: fast calls without progress, at depth 1 and 2", nestingScenarios());
  }
});

NodeRuntime.runMain(main());
