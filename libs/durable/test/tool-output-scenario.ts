import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import { Effect } from "effect";
import { Type } from "typebox";

import node from "../src/env/node.ts";
import toolsModule from "../src/tools/index.ts";
import support from "./support.ts";
import type toolOutputScenarioTypes from "./tool-output-scenario.types.ts";
import toolOutputStorage from "./tool-output-storage.ts";

const { LiveDoc, defineTool } = durable;
const { Harness, createRegistry } = harnessModule;
const { createBashTool } = toolsModule;
const { NodeExecutionEnv } = node;

const { addTool, awaited, context, makeTempFile, removeDir, tempPath } = support;
const { footprint, openStorage, timed } = toolOutputStorage;

const RATE_SECONDS = 3;
const GIB = 1 << 30;
const LINE = "The quick brown fox jumps over the lazy dog. Unique identifier";
const BIG_FILE = tempPath("msa-durable-bench-1gib.txt");

const RATES: Record<
  toolOutputScenarioTypes.Rate,
  { readonly lines: number; readonly pauseMs: number }
> = {
  high: { lines: 800, pauseMs: 0 },
  low: { lines: 1, pauseMs: 200 },
  normal: { lines: 25, pauseMs: 50 },
};

type Metrics = {
  ms: number;
  liveCommits: number;
  liveOpKiB: number;
  outputSets: number;
  commitP50Ms: number;
  commitP99Ms: number;
  midRoundKiB?: number;
  replayMs?: number;
  finalKiB?: number;
  peakRssMiB: number;
  heapAfterGcMiB?: number | undefined;
};

const pause = (pauseMs: number): Effect.Effect<void> =>
  pauseMs === 0 ? Effect.yieldNow : Effect.sleep(pauseMs);

function emitTool(
  scenario: Exclude<toolOutputScenarioTypes.Scenario, { kind: "cat" }>,
  flags: { readonly stop: boolean },
) {
  const rate = scenario.kind === "rate" ? RATES[scenario.rate] : RATES.high;
  return defineTool({
    description: "",
    execute: (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          let counter = 0;
          let written = 0;
          const prebuilt =
            scenario.kind === "firehose" ? lines(api.callId, 0, rate.lines) : undefined;
          const repeated = "y\n".repeat(32 * 1024 - 8);
          for (let turn = 0; ; turn++) {
            if (turn > 0) yield* pause(rate.pauseMs);
            if (flags.stop || (scenario.kind !== "rate" && written >= GIB)) break;
            const chunk =
              scenario.kind === "firehose" && scenario.repetitive === true
                ? `${repeated}#${counter}\n`
                : (prebuilt ?? lines(api.callId, counter, rate.lines));
            counter += rate.lines;
            api.output(chunk);
            written += chunk.length;
          }
          if (scenario.kind === "rate" && scenario.backend !== "memory") {
            const { promise, reject } = Promise.withResolvers<never>();
            callContext.abortSignal!.addEventListener("abort", () =>
              reject(callContext.abortSignal!.reason),
            );
            return yield* awaited(promise);
          }
          return {};
        }),
      ),
    name: "emit",
    outputLimits: { retain: scenario.retain },
    parameters: Type.Object({}),
  });
}

function scenarioModels(
  scenario: toolOutputScenarioTypes.Scenario,
  flags: { readonly stop: boolean },
) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const toolCount = scenario.kind === "rate" ? scenario.tools : 1;
  if (scenario.kind === "cat") {
    addTool(registry, createBashTool());
  } else {
    addTool(registry, emitTool(scenario, flags));
  }
  const call =
    scenario.kind === "cat"
      ? [fauxToolCall("bash", { command: `cat ${BIG_FILE}` }, { id: "c0" })]
      : Array.from({ length: toolCount }, (_, index) =>
          fauxToolCall("emit", {}, { id: `c${index}` }),
        );
  faux.setResponses([
    fauxAssistantMessage(call, { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  return { models, registry };
}

function liveObserver() {
  const counts = { liveCommits: 0, liveOpBytes: 0, outputSets: 0 };
  const observe = (target: toolOutputScenarioTypes.Harness): void => {
    target.subscribeCommits((publication) => {
      for (const change of publication.changes) {
        if (change.type !== "document" || change.record.kind !== "msa.live") continue;
        counts.liveCommits++;
        counts.liveOpBytes += JSON.stringify(change.ops).length;
        for (const op of change.ops)
          if (op[0] === "s" && op[1].at(-1) === "output") counts.outputSets++;
      }
    });
  };
  return { counts, observe };
}

type Opened = {
  readonly path: string;
  readonly reopen: () => Promise<toolOutputScenarioTypes.Harness>;
  readonly observe: (target: toolOutputScenarioTypes.Harness) => void;
};

const finishRate = Effect.fn("finishRate")(function* (
  scenario: toolOutputScenarioTypes.Scenario & { kind: "rate" },
  flags: { stop: boolean },
  { path, reopen, observe }: Opened,
  {
    harness,
    root,
    submission,
  }: {
    harness: toolOutputScenarioTypes.Harness;
    root: toolOutputScenarioTypes.Conversation;
    submission: Awaited<ReturnType<toolOutputScenarioTypes.Conversation["submit"]>>;
  },
  metrics: Partial<Metrics>,
) {
  yield* Effect.sleep((scenario.seconds ?? RATE_SECONDS) * 1000);
  flags.stop = true;
  if (scenario.backend === "memory") {
    yield* awaited(submission.wait(context));
    return harness;
  }
  yield* Effect.sleep(600);
  metrics.midRoundKiB = yield* footprint(scenario.backend, path);
  yield* awaited(harness.close(context));
  const reopened = performance.now();
  const next = yield* awaited(reopen());
  yield* awaited(next.snapshot(LiveDoc, root.id, context));
  observe(next);
  metrics.replayMs = Math.round(performance.now() - reopened);
  next.resume();
  yield* awaited((yield* awaited(next.submission(submission.id, context)))!.wait(context));
  return next;
});

const measureScenario = Effect.fn("measureScenario")(function* (
  scenario: toolOutputScenarioTypes.Scenario,
  { directory, path }: Effect.Success<ReturnType<typeof support.makeTempFile>>,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const latencies: number[] = [];
  const flags = { stop: false };
  const { models, registry } = scenarioModels(scenario, flags);
  const nodeEnv = new NodeExecutionEnv({ cwd: directory });
  const env = () => nodeEnv;
  const reopen = () =>
    runPromise(
      Effect.gen(function* () {
        return yield* awaited(
          Harness.open(
            timed(yield* awaited(openStorage(scenario.backend, path)), latencies),
            { env, models, registry },
            context,
          ),
        );
      }),
    );
  let harness = yield* awaited(reopen());
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );
  const { counts, observe } = liveObserver();
  observe(harness);
  const started = performance.now();
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  const metrics: Partial<Metrics> = {};
  if (scenario.kind === "rate") {
    harness = yield* finishRate(
      scenario,
      flags,
      { observe, path, reopen },
      { harness, root, submission },
      metrics,
    );
  } else {
    yield* awaited(submission.wait(context));
  }
  const ms = Math.round(performance.now() - started);
  if (scenario.backend !== "memory") metrics.finalKiB = yield* footprint(scenario.backend, path);
  yield* awaited(harness.close(context));
  return summarize({ counts, latencies, metrics, ms });
});

function summarize({
  ms,
  counts,
  latencies,
  metrics,
}: {
  ms: number;
  counts: ReturnType<typeof liveObserver>["counts"];
  latencies: number[];
  metrics: Partial<Metrics>;
}): Metrics {
  latencies.sort((a, b) => a - b);
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  return {
    commitP50Ms: round(latencies[Math.floor(latencies.length * 0.5)] ?? 0),
    commitP99Ms: round(latencies[Math.floor(latencies.length * 0.99)] ?? 0),
    liveCommits: counts.liveCommits,
    liveOpKiB: Math.round(counts.liveOpBytes / 1024),
    ms,
    outputSets: counts.outputSets,
    ...metrics,
    heapAfterGcMiB:
      gc === undefined ? undefined : Math.round(process.memoryUsage().heapUsed / 2 ** 20),
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
  };
}

const runScenario = Effect.fn("runScenario")(function* (
  scenario: toolOutputScenarioTypes.Scenario,
) {
  const name = scenario.backend === "sqlite" ? "session.sqlite" : "session";
  const temp = yield* makeTempFile("msa-durable-tool-bench-", name);
  const { directory } = temp;
  return yield* Effect.suspend(() => measureScenario(scenario, temp)).pipe(
    Effect.ensuring(Effect.asVoid(Effect.suspend(() => removeDir(directory)))),
  );
});

function lines(prefix: string, first: number, count: number): string {
  let text = "";
  for (let index = first; index < first + count; index++) text += `${prefix} ${index}: ${LINE}\n`;
  return text;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const toolOutputScenario = {
  BIG_FILE,
  GIB,
  LINE,
  runScenario,
};

export default toolOutputScenario;
