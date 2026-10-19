import type { AgentMessage, ThinkingLevel } from "@msa/agent-core";
import { type Api, fauxAssistantMessage, type Model } from "@msa/ai";
import { InMemoryTelemetryContext } from "@msa/telemetry";
import { Effect } from "effect";

import {
  type CreateWorkerOptions,
  Orchestrator,
  type OrchestratorReport,
  type WorkerSession,
} from "../src/core/orchestrator/orchestrator.ts";

function model(provider: string, id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "faux",
    provider,
    baseUrl: "",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 8192,
  };
}

export const MODELS = [model("sub", "fable"), model("fast", "flash"), model("fast", "tiny")];

export class FakeWorker implements WorkerSession {
  isStreaming = false;
  messages: AgentMessage[] = [];
  sessionFile: string;
  prompts: string[] = [];
  steered: string[] = [];
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  telemetry: CreateWorkerOptions["telemetry"];
  isRetrying = false;
  state: { streamingMessage?: AgentMessage } = {};
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
      resolve: (reply) => {
        this.messages = [...this.messages, fauxAssistantMessage(reply)];
        this.isStreaming = false;
        resolve();
      },
      reject: (error) => {
        this.isStreaming = false;
        reject(error);
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

  setModel = (next: Model<any>) => {
    this.model = next;
    return Promise.resolve();
  };

  setThinkingLevel = (level: ThinkingLevel) => {
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

export interface HarnessOptions {
  maxConcurrent?: number;
  pollIntervalMs?: number | null;
  runCondition?: (command: string, cwd: string) => Promise<boolean>;
  databasePath?: string;
}

function setup(options: HarnessOptions = {}) {
  const workers: FakeWorker[] = [];
  const reports: Array<{ text: string; details: OrchestratorReport }> = [];
  const telemetry = new InMemoryTelemetryContext();
  const orchestrator = new Orchestrator({
    telemetry,
    project: "project",
    cwd: "/repo",
    databasePath: options.databasePath ?? ":memory:",
    pollIntervalMs: options.pollIntervalMs ?? null,
    runCondition: options.runCondition ?? (() => Promise.resolve(true)),
    createWorker: (workerOptions) => {
      const worker = new FakeWorker(workerOptions, workers.length);
      workers.push(worker);
      return Promise.resolve(worker);
    },
    resolveModel: (reference) => {
      const found = MODELS.find(
        (candidate) => `${candidate.provider}/${candidate.id}` === reference,
      );
      if (found === undefined) throw new Error(`"${reference}" is not an available model`);
      return found;
    },
    defaults: () => ({
      workerModel: "fast/flash",
      workerThinkingLevel: "low",
      reviewModel: "sub/fable",
      reviewThinkingLevel: "high",
      maxConcurrentSessions: options.maxConcurrent ?? 4,
    }),
    report: (text, details) => reports.push({ text, details }),
  });
  return { orchestrator, workers, reports, telemetry };
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

export const harness = { model, setup, waitFor, taskStatus, reviews };
