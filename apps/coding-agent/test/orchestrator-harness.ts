import { tmpdir } from "node:os";

import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import telemetryModule from "@msa/telemetry";
import testing from "@msa/testing";
import { Effect } from "effect";

import {
  type CreateWorkerOptions,
  Orchestrator,
  type OrchestratorReport,
  type WorkerSession,
} from "../src/core/orchestrator/orchestrator.ts";
import type orchestratorHarnessTypes from "./orchestrator-harness.types.ts";

const { fauxAssistantMessage } = ai;

const { InMemoryTelemetryContext } = telemetryModule;

const { joinPath } = testing;

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

class FakeWorker implements WorkerSession {
  isStreaming = false;
  messages: agentTypes.AgentMessage[] = [];
  sessionFile: string;
  prompts: string[] = [];
  steered: string[] = [];
  model: aiTypes.Model<any>;
  thinkingLevel: agentTypes.ThinkingLevel;
  telemetry: CreateWorkerOptions["telemetry"];
  isRetrying = false;
  state: { streamingMessage?: agentTypes.AgentMessage } = {};
  private readonly pending: Array<{
    resolve: (reply: string) => void;
    reject: (error: unknown) => void;
  }> = [];

  constructor(options: CreateWorkerOptions, index: number) {
    this.model = options.model;
    this.thinkingLevel = options.thinkingLevel;
    this.telemetry = options.telemetry;
    this.sessionFile = `/sessions/${index}.jsonl`;
  }

  prompt = (text: string) => {
    this.prompts.push(text);
    this.isStreaming = true;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.pending.push({
      reject: (error) => {
        this.isStreaming = false;
        reject(error);
      },
      resolve: (reply) => {
        this.messages = [...this.messages, fauxAssistantMessage(reply)];
        this.isStreaming = false;
        resolve();
      },
    });
    return promise;
  };

  steer = (text: string) => {
    this.steered.push(text);
    return Promise.resolve("queued");
  };

  abort = () => {
    this.isStreaming = false;
    this.pending.pop()?.reject(new Error("aborted"));
    return Promise.resolve();
  };

  setModel = (next: aiTypes.Model<any>) => {
    this.model = next;
    return Promise.resolve();
  };

  setThinkingLevel = (level: agentTypes.ThinkingLevel) => {
    this.thinkingLevel = level;
  };

  dispose = () => {};

  subscribe = () => () => {};

  complete(reply: string): void {
    this.pending.shift()?.resolve(reply);
  }

  fail(error: Error): void {
    this.pending.shift()?.reject(error);
  }
}

function setup(options: orchestratorHarnessTypes.HarnessOptions = {}) {
  const workers: FakeWorker[] = [];
  const reports: Array<{ text: string; details: OrchestratorReport }> = [];
  const telemetry = new InMemoryTelemetryContext();
  const orchestrator = new Orchestrator({
    createWorker: (workerOptions) => {
      const worker = new FakeWorker(workerOptions, workers.length);
      workers.push(worker);
      return Promise.resolve(worker);
    },
    cwd: options.cwd ?? "/repo",
    databasePath: options.databasePath ?? ":memory:",
    defaults: () => ({
      maxConcurrentThreads: options.maxConcurrent ?? 4,
      reviewModel: "sub/fable",
      reviewThinkingLevel: "high",
      workerModel: "fast/flash",
      workerThinkingLevel: "low",
    }),
    handoffDirectory: options.handoffDirectory ?? joinPath(tmpdir(), "msa-orchestrator-handoffs"),
    pollIntervalMs: options.pollIntervalMs ?? null,
    project: "project",
    report: (text, details) => reports.push({ details, text }),
    resolveModel: (reference) => {
      const found = MODELS.find(
        (candidate) => `${candidate.provider}/${candidate.id}` === reference,
      );
      if (found === undefined) throw new Error(`"${reference}" is not an available model`);
      return found;
    },
    runCondition: options.runCondition ?? (() => Promise.resolve(true)),
    telemetry,
    version: "0.0.0-test",
  });
  return { orchestrator, reports, telemetry, workers };
}

function waitFor(predicate: () => boolean, attempts = 10_000): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let index = 0; index < attempts; index++) {
      if (predicate()) return;
      yield* Effect.sleep(2);
    }
    throw new Error("timed out waiting for the orchestrator");
  });
}

function taskStatus(orchestrator: Orchestrator, id: string): string | undefined {
  return orchestrator.snapshot.tasks.find((task) => task.id === id)?.status;
}

function reviews(orchestrator: Orchestrator) {
  return orchestrator.snapshot.tasks.filter((task) => task.kind === "review");
}

const harness = { model, reviews, setup, taskStatus, waitFor };

const orchestratorHarness = {
  FakeWorker,
  MODELS,
  harness,
};

export default orchestratorHarness;
