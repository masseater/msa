import type aiTypes from "@msa/ai/index.types";
import telemetryModule from "@msa/telemetry";
import testing from "@msa/testing";
import { Effect } from "effect";
import { onTestFinished } from "vite-plus/test";

import Orchestrator from "../src/core/orchestrator/orchestrator.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import FakeWorker from "./fake-worker.ts";
import type orchestratorHarnessTypes from "./orchestrator-harness.types.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";
const { InMemoryTelemetryContext } = telemetryModule;
const { joinPath, makeTempDir, pathExists, pollUntil, removePath, runTest, tempRoot } = testing;

const running = new Set<Orchestrator>();

function model(provider: string, id: string): aiTypes.Model<aiTypes.Api> {
  return {
    api: "faux",
    baseUrl: "",
    contextWindow: 200_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 8192,
    name: id,
    provider,
    reasoning: true,
  };
}
const MODELS = [model("sub", "fable"), model("fast", "flash"), model("fast", "tiny")];
function setup(options: orchestratorHarnessTypes.HarnessOptions = {}) {
  const cwd = options.cwd ?? "/repo";
  const existed = runTest(pathExists(cwd));
  const workers: FakeWorker[] = [];
  const reports: Array<{ text: string; details: orchestratorTypes.OrchestratorReport }> = [];
  const telemetry = new InMemoryTelemetryContext();
  const orchestrator = new Orchestrator({
    ciAppearMs: options.ciAppearMs ?? 20,
    ciPollMs: options.ciPollMs ?? 5,
    ciWaitMs: options.ciWaitMs,
    createWorker: (workerOptions) => {
      const worker = new FakeWorker(workerOptions, workers.length);
      workers.push(worker);
      return Promise.resolve(worker);
    },
    cwd,
    databasePath: options.databasePath ?? ":memory:",
    decide: options.decide ?? reviewVerdictSupport.passingDecide,
    defaults: () => ({
      maxConcurrentThreads: options.maxConcurrent ?? 4,
      reviewModel: "sub/fable",
      reviewThinkingLevel: "high",
      workerModel: "fast/flash",
      workerThinkingLevel: "low",
    }),
    handoffDirectory: options.handoffDirectory ?? joinPath(tempRoot(), "msa-orchestrator-handoffs"),
    pollIntervalMs: options.pollIntervalMs ?? null,
    project: options.project ?? "project",
    pullRequestSyncMs: options.pullRequestSyncMs ?? null,
    report: (text, details) => reports.push({ details, text }),
    resolveModel: (reference) => {
      const found = MODELS.find(
        (candidate) => `${candidate.provider}/${candidate.id}` === reference,
      );
      if (found === undefined) throw new Error(`"${reference}" is not an available model`);
      return found;
    },
    runCommand: options.runCommand ?? (() => Promise.resolve({ exitCode: 0, output: "" })),
    runGh:
      options.runGh ??
      (() => Promise.resolve({ code: 1, stderr: "this test has no GitHub", stdout: "" })),
    runPollMs: options.runPollMs,
    telemetry,
    version: "0.0.0-test",
  });
  running.add(orchestrator);
  onTestFinished(() => runTest(finished(orchestrator, cwd, existed)));
  return { orchestrator, reports, telemetry, workers };
}

function finished(orchestrator: Orchestrator, cwd: string, existed: Promise<boolean>) {
  return Effect.gen(function* () {
    const removedFirst =
      orchestrator.database.isOpen &&
      (yield* Effect.promise(() => existed)) &&
      !(yield* pathExists(cwd));
    yield* disposeOne(orchestrator);
    if (removedFirst) {
      return yield* Effect.die(
        new Error(
          `${cwd} was removed while its orchestrator was running. Dispose the orchestrator first: make the directory with orchestratorHarness.harness.withTempDir.`,
        ),
      );
    }
  });
}

function disposeOne(orchestrator: Orchestrator): Effect.Effect<void> {
  running.delete(orchestrator);
  return Effect.promise(() => orchestrator.dispose());
}

function disposeRunning(): Effect.Effect<void> {
  return Effect.forEach([...running], disposeOne, { discard: true });
}

function withTempDir<A, E>(prefix: string, body: (directory: string) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(makeTempDir(prefix), body, (directory) =>
    Effect.andThen(disposeRunning(), removePath(directory)),
  );
}
function waitFor(predicate: () => boolean, attempts = 10_000): Effect.Effect<void> {
  return pollUntil(Effect.sync(predicate), attempts, 2);
}
function taskStatus(orchestrator: orchestratorTypes.Orchestrator, id: string): string | undefined {
  return orchestrator.snapshot.tasks.find((task) => task.id === id)?.status;
}
function reviews(orchestrator: orchestratorTypes.Orchestrator) {
  return orchestrator.snapshot.tasks.filter((task) => task.kind === "review");
}
const harness = { disposeRunning, model, reviews, setup, taskStatus, waitFor, withTempDir };

const orchestratorHarness = {
  MODELS,
  harness,
};

export default orchestratorHarness;
