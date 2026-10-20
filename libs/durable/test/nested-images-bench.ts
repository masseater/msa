import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import modelsModule from "@msa/ai/models";
import fauxModule from "@msa/ai/providers/faux";
import { Console, Effect, Fiber } from "effect";

import harnessModule from "../src/harness/index.ts";
import durable from "../src/index.ts";
import benchSupport from "./bench-support.ts";
import registryFor from "./nested-images-bench-tools.ts";
import type nestedImagesBenchTypes from "./nested-images-bench.types.ts";
import support from "./support.ts";

const { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } = fauxModule;
const { createModels } = modelsModule;

const { Harness } = harnessModule;
const { ToolResultEntry } = durable;

const { directorySize, heapAfterGc, meterCommits, noWrites, openBenchStorage, requireGc } =
  benchSupport;
const { awaited, context, makeTempDir, removeDir, sampleEvery, toJsonText } = support;

type Written = Record<nestedImagesBenchTypes.StorageWrite["type"], number>;

type Result = {
  commits: number;
  ms: number;
  written: Written;
  storedLive: number;
  storedRun: number;
  storedClosed: number;
  storedReopened: number;
  peakHeap: number;
  settledHeap: number;
  idleHeap: number;
  reopenedHeap: number;
  nestedTasks: number;
  largestTask: number;
};

requireGc();

type Meter = {
  peakHeap: number;
  storedLive: number;
  commits: number;
  readonly written: Written;
  readonly sample: () => void;
};

function newMeter(): Meter {
  const meter: Meter = {
    commits: 0,
    peakHeap: 0,
    sample: () => {
      meter.peakHeap = Math.max(meter.peakHeap, process.memoryUsage().heapUsed);
    },
    storedLive: 0,
    written: noWrites(),
  };
  return meter;
}

function scenarioModels(
  scenario: nestedImagesBenchTypes.Scenario,
  directory: string,
  meter: Meter,
) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = registryFor(scenario, {
    beforeReturn: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          meter.storedLive = yield* directorySize(directory);
        }),
      ),
    sample: meter.sample,
  });
  return { faux, models, registry };
}

const openMetered = Effect.fn("openMetered")(function* (
  scenario: nestedImagesBenchTypes.Scenario,
  directory: string,
  meter: Meter,
  { faux, models, registry }: ReturnType<typeof scenarioModels>,
) {
  const storage = yield* awaited(openBenchStorage(scenario.backend, directory));
  meterCommits(storage, meter, meter.sample);
  const harness = yield* awaited(Harness.open(storage, { models, registry }, context));
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("script", { count: scenario.count }, { id: "s" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  return { harness, root };
});

const runScript = Effect.fn("runScript")(function* (
  root: Effect.Success<ReturnType<typeof openMetered>>["root"],
) {
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: "run", type: "input" }, context))).wait(context),
  );
  if (settled.status !== "done") throw new Error(`run: ${settled.status}`);
  const latest = (yield* awaited(root.entries({}, 10, undefined, context))).items;
  const result = latest.find((entry) => ToolResultEntry.is(entry))?.model?.[0];
  if (result?.role !== "toolResult" || result.isError) throw new Error("run: the script failed");
});

function writtenSince(written: Written, before: Written): Written {
  const delta = noWrites();
  for (const type of Object.keys(delta) as nestedImagesBenchTypes.StorageWrite["type"][]) {
    delta[type] = written[type] - before[type];
  }
  return delta;
}

const reopenAndScan = Effect.fn("reopenAndScan")(function* (
  scenario: nestedImagesBenchTypes.Scenario,
  directory: string,
  { models, registry }: ReturnType<typeof scenarioModels>,
  baseHeap: number,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const reopenedStorage = yield* awaited(openBenchStorage(scenario.backend, directory));
  const reopened = yield* awaited(Harness.open(reopenedStorage, { models, registry }, context));
  const reopenedHeap = heapAfterGc() - baseHeap;
  const storedReopened = yield* directorySize(directory);
  const tasks = { largestTask: 0, nestedTasks: 0 };
  const scan = (
    cursor?: Parameters<nestedImagesBenchTypes.Storage["scanTasks"]>[2],
  ): Promise<void> =>
    runPromise(
      Effect.gen(function* () {
        const page = yield* awaited(
          reopenedStorage.scanTasks({ kind: "msa.tool" }, 50, cursor, context),
        );
        for (const record of page.items) {
          if ((record.input as nestedImagesBenchTypes.ToolTaskInput).kind === "nested")
            tasks.nestedTasks++;
          tasks.largestTask = Math.max(tasks.largestTask, (yield* toJsonText(record)).length);
        }
        if (page.next !== undefined) yield* awaited(scan(page.next));
      }),
    );
  yield* awaited(scan());
  yield* awaited(reopened.close(context));
  return { reopenedHeap, storedReopened, ...tasks };
});

const measureScenario = Effect.fn("measureScenario")(function* (
  scenario: nestedImagesBenchTypes.Scenario,
  directory: string,
) {
  const meter = newMeter();
  const setup = scenarioModels(scenario, directory, meter);
  const baseHeap = heapAfterGc();

  const { harness, root } = yield* openMetered(scenario, directory, meter, setup);
  const before = { commits: meter.commits, written: { ...meter.written } };
  meter.peakHeap = 0;
  const sampler = yield* sampleEvery(5, meter.sample);
  const started = performance.now();
  yield* runScript(root);
  const ms = Math.round(performance.now() - started);
  yield* Fiber.interrupt(sampler);
  const settledHeap = heapAfterGc() - baseHeap;
  yield* awaited(harness.waitForIdle(context));
  const idleHeap = heapAfterGc() - baseHeap;
  const delta = writtenSince(meter.written, before.written);
  const storedRun = yield* directorySize(directory);
  yield* awaited(harness.close(context));
  const storedClosed = yield* directorySize(directory);

  const reopened = yield* reopenAndScan(scenario, directory, setup, baseHeap);
  const result: Result = {
    commits: meter.commits - before.commits,
    idleHeap,
    ms,
    peakHeap: meter.peakHeap - baseHeap,
    settledHeap,
    storedClosed,
    storedLive: meter.storedLive,
    storedRun,
    written: delta,
    ...reopened,
  };
  return result;
});

const runScenario = Effect.fn("runScenario")(function* (scenario: nestedImagesBenchTypes.Scenario) {
  const directory = yield* makeTempDir("msa-durable-images-bench-");
  return yield* Effect.suspend(() => measureScenario(scenario, directory)).pipe(
    Effect.ensuring(Effect.asVoid(Effect.suspend(() => removeDir(directory)))),
  );
});

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

const main = Effect.fn("main")(function* () {
  const counts = process.argv[2] === undefined ? [50, 200] : [Number(process.argv[2])];
  const bytes = 1024 * 1024;
  yield* Console.log(
    `Images: ${bytes / 1024} KiB base64 each, read then classified sequentially in one script call`,
  );
  yield* Console.log(
    "backend | variant   | count | commits, ms | written: all (task / doc create / doc change / entry) | stored: live / run / closed / reopened | heap: peak; settled / idle / reopened | nested tasks, largest task",
  );
  for (const count of counts) {
    for (const backend of ["sqlite", "jsonl"] as const) {
      for (const variant of ["inline", "reference"] as const) {
        const result = yield* runScenario({ backend, bytes, count, variant });
        const all = Object.values(result.written).reduce((sum, value) => sum + value, 0);
        const written = result.written;
        yield* Console.log(
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
});

NodeRuntime.runMain(main());
