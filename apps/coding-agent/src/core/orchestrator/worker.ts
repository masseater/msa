import type { AgentMessage, ThinkingLevel } from "@msa/agent-core";
import type { Model } from "@msa/ai/compat";
import type { TelemetryContext } from "@msa/telemetry";

import type { SessionTelemetryOptions } from "../observability/session-telemetry.ts";

export interface WorkerSession {
  prompt(text: string): Promise<unknown>;
  steer(text: string): Promise<unknown>;
  abort(): Promise<unknown>;
  setModel(model: Model<any>): Promise<unknown>;
  setThinkingLevel(level: ThinkingLevel): void;
  isStreaming: boolean;
  messages: readonly AgentMessage[];
  sessionFile?: string | undefined;
  state: { streamingMessage?: AgentMessage | undefined };
  isRetrying: boolean;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface CreateWorkerOptions {
  cwd: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  sessionFile?: string | undefined;
  telemetry: SessionTelemetryOptions;
}

export interface OrchestratorDefaults {
  workerModel: string;
  workerThinkingLevel: ThinkingLevel;
  reviewModel: string;
  reviewThinkingLevel: ThinkingLevel;
  maxConcurrentSessions: number;
}

export interface OrchestratorReport {
  taskId: string;
  role: "worker" | "reviewer";
  status: "completed" | "failed";
  started: readonly string[];
}

export interface OrchestratorOptions {
  project: string;
  cwd: string;
  databasePath: string;
  createWorker: (options: CreateWorkerOptions) => Promise<WorkerSession>;
  resolveModel: (reference: string) => Model<any>;
  defaults: () => OrchestratorDefaults;
  report: (text: string, details: OrchestratorReport) => void;
  runCondition: (command: string, cwd: string) => Promise<boolean>;
  pollIntervalMs?: number | null;
  /** Parent of the Task spans; each Session span sits under its first task. */
  telemetry: TelemetryContext;
}
