/**
 * Nested tool call storage benchmark. Per run, one model-issued tool makes `calls` parallel nested calls of `blob`,
 * each streaming `bytes` of output in 8 chunks `gapMs` apart; at depth 2 it makes them through `calls / 10` parallel
 * `fan` calls of 10 each. With `progress: false` the nested calls commit no running output. Reports commits, logical
 * bytes written (JSON of the storage writes) by write type, the stored size after each run, and the heap: its peak during a run, sampled every 5 ms, and what stays after a
 * run and a GC, both over the heap after a GC before the first run. A 2 ms gap is a fast tool such as `read`: it ends
 * before a second progress commit. A 50 ms gap streams for 400 ms, as a short `bash` command does, and commits progress
 * every 100 ms.
 *
 *   node --conditions=source --experimental-strip-types --expose-gc test/nested-tools-bench.ts [streaming|nesting]
 */

import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Type } from "typebox";

import {
  type Conversation,
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  type StorageWrite,
  ToolResultEntry,
} from "../src/index.ts";
import {
  type Backend,
  directorySize,
  heapAfterGc,
  meterCommits,
  noWrites,
  openBenchStorage,
  requireGc,
  type Written,
} from "./bench-support.ts";
import { makeTempDir, removeDir } from "./temp-support.ts";

type Scenario = {
  backend: Backend;
  calls: number;
  depth: 1 | 2;
  bytes: number;
  gapMs: number;
  /** Whether nested calls stream their running output to `msa.live`. */
  progress: boolean;
  runs: number;
};
type Run = {
  commits: number;
  written: Written;
  storedBytes: number;
  ms: number;
  /** Over the heap after a GC before the first run. */
  peakHeap: number;
  heldHeap: number;
};

requireGc();

const CHUNKS = 8;
/** Calls each inner `fan` makes at depth 2. */
const FAN_OUT = 10;

// Streams its output and returns none, so its result is the retained output, as bash's is.
function blobTool(scenario: Scenario) {
  const chunk = `${"x".repeat(scenario.bytes / CHUNKS - 1)}\n`;
  return defineTool({
    name: "blob",
    description: "Stream a blob",
    parameters: Type.Object({ n: Type.Number() }),
    execute: async (_args, api) => {
      for await (const _ of Array.from({ length: CHUNKS })) {
        api.output(chunk);
        await new Promise((resolve) => {
          setTimeout(resolve, scenario.gapMs);
        });
      }
      return {};
    },
  });
}

// A tool that makes `count` parallel nested calls of `target`, which get `{ n, count: FAN_OUT }`.
function fanOut(name: string, target: string, options: { readonly progress?: false }) {
  return defineTool({
    name,
    description: `Call ${target} in parallel`,
    parameters: Type.Object({ count: Type.Number() }),
    execute: async (args, api, callContext) => {
      const calls = Array.from({ length: args.count }, (_, n) =>
        api.executeTool(target, { n, count: FAN_OUT }, callContext, options),
      );
      const failed = (await Promise.all(calls)).filter((result) => result.isError).length;
      return { output: [{ type: "text", text: `${failed} failed` }], isError: failed > 0 };
    },
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

// Commits and written characters per write type.
type Meter = { commits: number; readonly written: Written };

async function openMetered(scenario: Scenario, directory: string) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = benchRegistry(scenario);

  const storage = await openBenchStorage(scenario.backend, directory);
  const meter: Meter = { commits: 0, written: noWrites() };
  meterCommits(storage, meter);
  const harness = await Harness.open(storage, { models, registry }, context);
  const root = await harness.root(context, {
    agent: { model: { provider: "faux", modelId: "faux-1" } },
  });
  return { faux, meter, harness, root };
}

async function measureRun(
  scenario: Scenario,
  directory: string,
  { faux, meter, harness, root }: Awaited<ReturnType<typeof openMetered>>,
  { run, baseHeap }: { readonly run: number; readonly baseHeap: number },
): Promise<Run> {
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
  const sampler = setInterval(() => {
    heap.peak = Math.max(heap.peak, process.memoryUsage().heapUsed);
  }, 5);
  const started = performance.now();
  const settled = await (
    await root.submit({ type: "input", content: `run ${run}` }, context)
  ).wait(context);
  if (settled.status !== "done") throw new Error(`run ${run}: ${settled.status}`);
  await assertToolsSucceeded(root, run);
  await harness.waitForIdle(context);
  const ms = Math.round(performance.now() - started);
  clearInterval(sampler);
  const delta = noWrites();
  for (const type of Object.keys(delta) as StorageWrite["type"][]) {
    delta[type] = meter.written[type] - before.written[type];
  }
  return {
    commits: meter.commits - before.commits,
    written: delta,
    storedBytes: await directorySize(directory),
    ms,
    peakHeap: heap.peak - baseHeap,
    heldHeap: heapAfterGc() - baseHeap,
  };
}

async function runScenario(scenario: Scenario): Promise<{ perRun: Run[]; closedBytes: number }> {
  const directory = await makeTempDir("msa-durable-nested-bench-");
  try {
    const opened = await openMetered(scenario, directory);
    const perRun: Run[] = [];
    const baseHeap = heapAfterGc();
    for await (const run of Array.from({ length: scenario.runs }, (_, i) => i)) {
      perRun.push(await measureRun(scenario, directory, opened, { run, baseHeap }));
    }
    await opened.harness.close(context);
    return { perRun, closedBytes: await directorySize(directory) };
  } finally {
    await removeDir(directory);
  }
}

// A run that answers `done` may still have failed tools; the model-issued call's result says whether any did.
async function assertToolsSucceeded(root: Conversation, run: number): Promise<void> {
  const page = await root.entries({}, 10, undefined, context);
  const result = page.items.find((entry) => ToolResultEntry.is(entry))?.model?.[0];
  if (result?.role !== "toolResult" || result.isError)
    throw new Error(`run ${run}: a nested call failed`);
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function report(title: string, scenarios: Scenario[]): Promise<void> {
  console.log(`\n${title}`);
  console.log(
    "backend | calls | depth | output | gap   | stream | run 1: commits, ms, written (all; tasks / doc changes / doc creates) | stored after run 1 / 2 / 3 | after close | heap: run 1 peak; held after run 1 / 2 / 3",
  );
  for await (const scenario of scenarios) {
    const { perRun, closedBytes } = await runScenario(scenario);
    const first = perRun[0]!;
    const all = Object.values(first.written).reduce((sum, bytes) => sum + bytes, 0);
    console.log(
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
}

// Every combination of backend, output size, gap, and progress, in that nesting order.
function streamingScenarios(): Scenario[] {
  return (["sqlite", "jsonl"] as const).flatMap((backend) =>
    [1024, 16 * 1024].flatMap((bytes) =>
      [2, 50].flatMap((gapMs) =>
        [true, false].map((progress) => ({
          backend,
          calls: 200,
          depth: 1 as const,
          bytes,
          gapMs,
          progress,
          runs: 3,
        })),
      ),
    ),
  );
}

// Every combination of backend, call count, and depth, in that nesting order.
function nestingScenarios(): Scenario[] {
  return (["sqlite", "jsonl"] as const).flatMap((backend) =>
    [200, 2000].flatMap((calls) =>
      ([1, 2] as const).map((depth) => ({
        backend,
        calls,
        depth,
        bytes: 1024,
        gapMs: 2,
        progress: false,
        runs: 3,
      })),
    ),
  );
}

async function main(): Promise<void> {
  const section = process.argv[2];
  if (section === undefined || section === "streaming") {
    await report("Streaming: 200 calls, with and without progress", streamingScenarios());
  }
  if (section === undefined || section === "nesting") {
    await report("Nesting: fast calls without progress, at depth 1 and 2", nestingScenarios());
  }
}

await main();
