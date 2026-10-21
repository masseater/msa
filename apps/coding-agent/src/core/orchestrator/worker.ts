import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type telemetryTypes from "@msa/telemetry/index.types";

import type sessionTelemetryTypes from "../observability/session-telemetry.types.ts";

declare namespace workerTypes {
  interface WorkerSession {
    run: {
      prompting: { prompt(text: string): Promise<unknown> };
      queue: { steer(text: string): Promise<unknown> };
      lifecycle: { abort(): Promise<unknown> };
      retry: { isRetrying: boolean };
    };
    models: {
      selection: { setModel(model: compatTypes.Model<any>): Promise<unknown> };
      thinking: { setThinkingLevel(level: agentTypes.ThinkingLevel): void };
    };
    isStreaming: boolean;
    messages: readonly agentTypes.AgentMessage[];
    sessionFile?: string | undefined;
    state: { streamingMessage?: agentTypes.AgentMessage | undefined };
    subscribe(listener: () => void): () => void;
    dispose(): void;
  }

  interface CreateWorkerOptions {
    cwd: string;
    model: compatTypes.Model<any>;
    thinkingLevel: agentTypes.ThinkingLevel;
    sessionFile?: string | undefined;
    telemetry: sessionTelemetryTypes.SessionTelemetryOptions;
  }

  interface OrchestratorDefaults {
    workerModel: string;
    workerThinkingLevel: agentTypes.ThinkingLevel;
    reviewModel: string;
    reviewThinkingLevel: agentTypes.ThinkingLevel;
    maxConcurrentThreads: number;
  }

  interface CommandResult {
    exitCode: number | null;
    output: string;
  }

  interface OrchestratorReport {
    taskId: string;
    role: "worker" | "reviewer";
    status: "completed" | "failed";
    started: readonly string[];
  }

  interface WatchdogOptions {
    intervalMs: number;
    idleMs: number;
  }

  interface OrchestratorOptions {
    project: string;
    cwd: string;
    databasePath: string;

    handoffDirectory: string;

    version: string;
    createWorker: (options: CreateWorkerOptions) => Promise<WorkerSession>;
    resolveModel: (reference: string) => compatTypes.Model<any>;
    defaults: () => OrchestratorDefaults;
    report: (text: string, details: OrchestratorReport) => void;
    runCommand: (
      command: string,
      cwd: string,
      timeoutMs: number,
      signal: AbortSignal,
    ) => Promise<CommandResult>;
    pollIntervalMs?: number | null;
    watchdog?: WatchdogOptions | null;

    telemetry: telemetryTypes.TelemetryContext;
  }
}

export type { workerTypes as default };
