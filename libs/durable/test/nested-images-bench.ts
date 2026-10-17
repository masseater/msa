/**
 * Nested image storage benchmark. One model-issued `script` call, as a code mode call would, loops `count` times: a
 * nested `read_image` call returns a unique base64 image of `bytes` characters, then a nested `classify` call reads it.
 * The `inline` variant passes the image data in `classify`'s arguments; the `reference` variant passes the `taskId` of
 * the `read_image` result, whose value is the image, and `classify` resolves it from its caller's `NestedCallDoc`.
 * Reports commits, wall time, logical bytes written (JSON of the storage writes) by write type, the stored size before
 * `script` returns, after the run settles, after close, and after reopening, the heap (peak during the run, sampled
 * every 5 ms and at each commit; after a GC once the run settles, after `waitForIdle()`, and after reopening; all over
 * the heap after a GC before opening), the number of nested task records, and the size of the largest one.
 *
 *   node --conditions=source --experimental-strip-types --expose-gc test/nested-images-bench.ts [count]
 */

import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";

import {
  Harness,
  type Storage,
  type StorageWrite,
  ToolResultEntry,
  type ToolTaskInput,
} from "../src/index.ts";
import {
  directorySize,
  heapAfterGc,
  meterCommits,
  noWrites,
  openBenchStorage,
  requireGc,
  type Written,
} from "./bench-support.ts";
import { registryFor, type Scenario } from "./nested-images-bench-tools.ts";
import { makeTempDir, removeDir } from "./temp-support.ts";

type Result = {
  commits: number;
  ms: number;
  written: Written;
  /** Before `script` returns, while its nested results are live. */
  storedLive: number;
  storedRun: number;
  storedClosed: number;
  storedReopened: number;
  /** Over the heap after a GC before opening. */
  peakHeap: number;
  settledHeap: number;
  idleHeap: number;
  reopenedHeap: number;
  nestedTasks: number;
  largestTask: number;
};

requireGc();

// What a scenario samples while it runs: the heap peak, the stored size before `script` returns, and every commit.
type Meter = {
  peakHeap: number;
  storedLive: number;
  commits: number;
  readonly written: Written;
  readonly sample: () => void;
};

function newMeter(): Meter {
  const meter: Meter = {
    peakHeap: 0,
    storedLive: 0,
    commits: 0,
    written: noWrites(),
    sample: () => {
      meter.peakHeap = Math.max(meter.peakHeap, process.memoryUsage().heapUsed);
    },
  };
  return meter;
}

function scenarioModels(scenario: Scenario, directory: string, meter: Meter) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = registryFor(scenario, {
    sample: meter.sample,
    beforeReturn: async () => {
      meter.storedLive = await directorySize(directory);
    },
  });
  return { faux, models, registry };
}

async function openMetered(
  scenario: Scenario,
  directory: string,
  meter: Meter,
  { faux, models, registry }: ReturnType<typeof scenarioModels>,
) {
  const storage = await openBenchStorage(scenario.backend, directory);
  // SQLite commits synchronously, which can starve the timer; sample at each commit too.
  meterCommits(storage, meter, meter.sample);
  const harness = await Harness.open(storage, { models, registry }, context);
  const root = await harness.root(context, {
    agent: { model: { provider: "faux", modelId: "faux-1" } },
  });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("script", { count: scenario.count }, { id: "s" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  return { harness, root };
}

async function runScript(root: Awaited<ReturnType<typeof openMetered>>["root"]): Promise<void> {
  const settled = await (
    await root.submit({ type: "input", content: "run" }, context)
  ).wait(context);
  if (settled.status !== "done") throw new Error(`run: ${settled.status}`);
  // `done` only says the model answered; the script's result says whether it ran through.
  const latest = (await root.entries({}, 10, undefined, context)).items;
  const result = latest.find((entry) => ToolResultEntry.is(entry))?.model?.[0];
  if (result?.role !== "toolResult" || result.isError) throw new Error("run: the script failed");
}

function writtenSince(written: Written, before: Written): Written {
  const delta = noWrites();
  for (const type of Object.keys(delta) as StorageWrite["type"][]) {
    delta[type] = written[type] - before[type];
  }
  return delta;
}

async function reopenAndScan(
  scenario: Scenario,
  directory: string,
  { models, registry }: ReturnType<typeof scenarioModels>,
  baseHeap: number,
) {
  const reopenedStorage = await openBenchStorage(scenario.backend, directory);
  const reopened = await Harness.open(reopenedStorage, { models, registry }, context);
  const reopenedHeap = heapAfterGc() - baseHeap;
  const storedReopened = await directorySize(directory);
  const tasks = { nestedTasks: 0, largestTask: 0 };
  const scan = async (cursor?: Parameters<Storage["scanTasks"]>[2]): Promise<void> => {
    const page = await reopenedStorage.scanTasks({ kind: "msa.tool" }, 50, cursor, context);
    for (const record of page.items) {
      if ((record.input as ToolTaskInput).kind === "nested") tasks.nestedTasks++;
      tasks.largestTask = Math.max(tasks.largestTask, JSON.stringify(record).length);
    }
    if (page.next !== undefined) await scan(page.next);
  };
  await scan();
  await reopened.close(context);
  return { reopenedHeap, storedReopened, ...tasks };
}

async function measureScenario(scenario: Scenario, directory: string): Promise<Result> {
  const meter = newMeter();
  const setup = scenarioModels(scenario, directory, meter);
  const baseHeap = heapAfterGc();

  const { harness, root } = await openMetered(scenario, directory, meter, setup);
  const before = { commits: meter.commits, written: { ...meter.written } };
  meter.peakHeap = 0;
  const sampler = setInterval(meter.sample, 5);
  const started = performance.now();
  await runScript(root);
  const ms = Math.round(performance.now() - started);
  clearInterval(sampler);
  const settledHeap = heapAfterGc() - baseHeap;
  await harness.waitForIdle(context);
  const idleHeap = heapAfterGc() - baseHeap;
  const delta = writtenSince(meter.written, before.written);
  const storedRun = await directorySize(directory);
  await harness.close(context);
  const storedClosed = await directorySize(directory);

  const reopened = await reopenAndScan(scenario, directory, setup, baseHeap);
  return {
    commits: meter.commits - before.commits,
    ms,
    written: delta,
    storedLive: meter.storedLive,
    storedRun,
    storedClosed,
    peakHeap: meter.peakHeap - baseHeap,
    settledHeap,
    idleHeap,
    ...reopened,
  };
}

async function runScenario(scenario: Scenario): Promise<Result> {
  const directory = await makeTempDir("msa-durable-images-bench-");
  try {
    return await measureScenario(scenario, directory);
  } finally {
    await removeDir(directory);
  }
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function main(): Promise<void> {
  const counts = process.argv[2] === undefined ? [50, 200] : [Number(process.argv[2])];
  const bytes = 1024 * 1024;
  console.log(
    `Images: ${bytes / 1024} KiB base64 each, read then classified sequentially in one script call`,
  );
  console.log(
    "backend | variant   | count | commits, ms | written: all (task / doc create / doc change / entry) | stored: live / run / closed / reopened | heap: peak; settled / idle / reopened | nested tasks, largest task",
  );
  for await (const count of counts) {
    for await (const backend of ["sqlite", "jsonl"] as const) {
      for await (const variant of ["inline", "reference"] as const) {
        const result = await runScenario({ backend, variant, count, bytes });
        const all = Object.values(result.written).reduce((sum, value) => sum + value, 0);
        const written = result.written;
        console.log(
          [
            backend.padEnd(7),
            variant.padEnd(9),
            String(count).padEnd(5),
            `${result.commits}, ${result.ms} ms`,
            `${mib(all)} (${mib(written.task)} / ${mib(written["document.create"])} / ${mib(written["document.change"])} / ${mib(written.entry)})`,
            `${mib(result.storedLive)} / ${mib(result.storedRun)} / ${mib(result.storedClosed)} / ${mib(result.storedReopened)}`,
            `${mib(result.peakHeap)}; ${mib(result.settledHeap)} / ${mib(result.idleHeap)} / ${mib(result.reopenedHeap)}`,
            `${result.nestedTasks}, ${kib(result.largestTask)}`,
          ].join(" | "),
        );
      }
    }
  }
}

await main();
