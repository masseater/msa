import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Type } from "typebox";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { createRegistry, Harness } from "../src/harness/index.ts";
import { defineTool, LiveDoc, type Conversation } from "../src/index.ts";
import { createBashTool } from "../src/tools/index.ts";
import { addTool } from "./harness-support.ts";
import { makeTempFile, removeDir, type TempFile, tempPath } from "./temp-support.ts";
import { type Backend, footprint, openStorage, timed } from "./tool-output-storage.ts";

type Rate = "low" | "normal" | "high";

export type Scenario =
  | {
      kind: "rate";
      backend: Backend;
      rate: Rate;
      retain: "head" | "tail";
      tools: number;
      seconds?: number;
    }
  | { kind: "firehose"; backend: Backend; retain: "head" | "tail"; repetitive?: boolean }
  | { kind: "cat"; backend: Backend };

const RATE_SECONDS = 3;
export const GIB = 1 << 30;
export const LINE = "The quick brown fox jumps over the lazy dog. Unique identifier";
export const BIG_FILE = tempPath("msa-durable-bench-1gib.txt");

/** Output one tool writes per tick, and the pause between ticks. */
const RATES: Record<Rate, { readonly lines: number; readonly pauseMs: number }> = {
  // A line every 200 ms, like a slow build step.
  low: { lines: 1, pauseMs: 200 },
  // Bursts of 25 lines every 50 ms (~40 KB/s), like a compiler or test run.
  normal: { lines: 25, pauseMs: 50 },
  // Continuous 64 KiB chunks, yielding to the event loop between them.
  high: { lines: 800, pauseMs: 0 },
};

type Metrics = {
  ms: number;
  liveCommits: number;
  liveOpKiB: number;
  /** Output writes recorded as a whole-string set, including each slot's first write; the rest are appends/trims. */
  outputSets: number;
  commitP50Ms: number;
  commitP99Ms: number;
  midRoundKiB?: number;
  replayMs?: number;
  finalKiB?: number;
  peakRssMiB: number;
  heapAfterGcMiB?: number | undefined;
};

// One turn per write: the first at once, each later one after `pauseMs`, or after an immediate when it is 0.
async function* turns(pauseMs: number): AsyncGenerator<void> {
  yield;
  for (;;) {
    yield new Promise<void>((resolve) => {
      if (pauseMs === 0) setImmediate(resolve);
      else setTimeout(resolve, pauseMs);
    });
  }
}

// Emits the scenario's output until stopped, or a GiB for a firehose.
function emitTool(scenario: Exclude<Scenario, { kind: "cat" }>, flags: { readonly stop: boolean }) {
  const rate = scenario.kind === "rate" ? RATES[scenario.rate] : RATES.high;
  return defineTool({
    name: "emit",
    description: "",
    parameters: Type.Object({}),
    outputLimits: { retain: scenario.retain },
    execute: async (_args, api, callContext) => {
      let counter = 0;
      let written = 0;
      // The firehose reuses one prebuilt chunk so it measures the Harness, not string building.
      const prebuilt = scenario.kind === "firehose" ? lines(api.callId, 0, rate.lines) : undefined;
      // Repetitive: identical lines with one numbered line per chunk, so the tail window keeps sliding.
      const repeated = "y\n".repeat(32 * 1024 - 8);
      for await (const _ of turns(rate.pauseMs)) {
        if (flags.stop || (scenario.kind !== "rate" && written >= GIB)) break;
        const chunk =
          scenario.kind === "firehose" && scenario.repetitive === true
            ? `${repeated}#${counter}\n`
            : (prebuilt ?? lines(api.callId, counter, rate.lines));
        counter += rate.lines;
        api.output(chunk);
        written += chunk.length;
      }
      // A persistent rate scenario stays in flight until close, so reopen replays the round.
      if (scenario.kind === "rate" && scenario.backend !== "memory") {
        await new Promise((_, reject) => {
          callContext.abortSignal!.addEventListener("abort", () =>
            reject(callContext.abortSignal!.reason),
          );
        });
      }
      return {};
    },
  });
}

function scenarioModels(scenario: Scenario, flags: { readonly stop: boolean }) {
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

// Counts the `msa.live` commits of every observed Harness, their operation bytes, and their output sets.
function liveObserver() {
  const counts = { liveCommits: 0, liveOpBytes: 0, outputSets: 0 };
  const observe = (target: Harness): void => {
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
  readonly reopen: () => Promise<Harness>;
  readonly observe: (target: Harness) => void;
};

// Let the rate run for its time, then stop it. A persistent one closes mid-round and times replay on reopen.
async function finishRate(
  scenario: Scenario & { kind: "rate" },
  flags: { stop: boolean },
  { path, reopen, observe }: Opened,
  {
    harness,
    root,
    submission,
  }: {
    harness: Harness;
    root: Conversation;
    submission: Awaited<ReturnType<Conversation["submit"]>>;
  },
  metrics: Partial<Metrics>,
): Promise<Harness> {
  await new Promise((resolve) => {
    setTimeout(resolve, (scenario.seconds ?? RATE_SECONDS) * 1000);
  });
  flags.stop = true;
  if (scenario.backend === "memory") {
    await submission.wait(context);
    return harness;
  }
  // Let the last progress commit land, then close mid-round and time replay on reopen.
  await new Promise((resolve) => {
    setTimeout(resolve, 600);
  });
  metrics.midRoundKiB = await footprint(scenario.backend, path);
  await harness.close(context);
  const reopened = performance.now();
  const next = await reopen();
  await next.snapshot(LiveDoc, root.id, context);
  observe(next);
  metrics.replayMs = Math.round(performance.now() - reopened);
  next.resume();
  await (await next.submission(submission.id, context))!.wait(context);
  return next;
}

async function measureScenario(
  scenario: Scenario,
  { directory, path }: TempFile,
): Promise<Metrics> {
  const latencies: number[] = [];
  const flags = { stop: false };
  const { models, registry } = scenarioModels(scenario, flags);
  const nodeEnv = new NodeExecutionEnv({ cwd: directory });
  const env = () => nodeEnv;
  const reopen = async () =>
    Harness.open(
      timed(await openStorage(scenario.backend, path), latencies),
      { models, registry, env },
      context,
    );
  let harness = await reopen();
  const root = await harness.root(context, {
    agent: { model: { provider: "faux", modelId: "faux-1" } },
  });
  const { counts, observe } = liveObserver();
  observe(harness);
  const started = performance.now();
  const submission = await root.submit({ type: "input", content: "go" }, context);
  const metrics: Partial<Metrics> = {};
  if (scenario.kind === "rate") {
    harness = await finishRate(
      scenario,
      flags,
      { path, reopen, observe },
      { harness, root, submission },
      metrics,
    );
  } else {
    await submission.wait(context);
  }
  const ms = Math.round(performance.now() - started);
  if (scenario.backend !== "memory") metrics.finalKiB = await footprint(scenario.backend, path);
  await harness.close(context);
  return summarize({ ms, counts, latencies, metrics });
}

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
    ms,
    liveCommits: counts.liveCommits,
    liveOpKiB: Math.round(counts.liveOpBytes / 1024),
    outputSets: counts.outputSets,
    commitP50Ms: round(latencies[Math.floor(latencies.length * 0.5)] ?? 0),
    commitP99Ms: round(latencies[Math.floor(latencies.length * 0.99)] ?? 0),
    ...metrics,
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    heapAfterGcMiB:
      gc === undefined ? undefined : Math.round(process.memoryUsage().heapUsed / 2 ** 20),
  };
}

export async function runScenario(scenario: Scenario): Promise<Metrics> {
  const name = scenario.backend === "sqlite" ? "session.sqlite" : "session";
  const temp = await makeTempFile("msa-durable-tool-bench-", name);
  const { directory } = temp;
  try {
    return await measureScenario(scenario, temp);
  } finally {
    await removeDir(directory);
  }
}

function lines(prefix: string, first: number, count: number): string {
  let text = "";
  for (let index = first; index < first + count; index++) text += `${prefix} ${index}: ${LINE}\n`;
  return text;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
