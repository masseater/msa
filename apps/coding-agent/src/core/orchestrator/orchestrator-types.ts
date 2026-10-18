import type { ThinkingLevel } from "@msa/agent-core";
import type { Model } from "@msa/ai/compat";

import type { AgentSession } from "../agent-session.ts";
import type {
  SessionGraph,
  SessionKind,
  SessionNodeWithDependencies,
  SessionStatus,
} from "./graph.ts";

export type WorkerSession = Pick<
  AgentSession,
  | "prompt"
  | "steer"
  | "abort"
  | "setModel"
  | "setThinkingLevel"
  | "isStreaming"
  | "messages"
  | "sessionFile"
  | "state"
  | "isRetrying"
  | "subscribe"
  | "dispose"
>;

export interface CreateWorkerOptions {
  cwd: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  sessionFile?: string | undefined;
}

export interface OrchestratorDefaults {
  workerModel: string;
  workerThinkingLevel: ThinkingLevel;
  reviewModel: string;
  reviewThinkingLevel: ThinkingLevel;
  maxConcurrentSessions: number;
}

export interface OrchestratorReport {
  sessionId: string;
  kind: SessionKind;
  status: SessionStatus;
  started: string[];
}

export interface OrchestratorOptions {
  project: string;
  cwd: string;
  connectGraph: () => Promise<SessionGraph>;
  createWorker: (options: CreateWorkerOptions) => Promise<WorkerSession>;
  resolveModel: (reference: string) => Model<any>;
  defaults: () => OrchestratorDefaults;
  report: (text: string, details: OrchestratorReport) => void;
}

export interface StartSessionInput {
  title: string;
  prompt: string;
  dependsOn: readonly string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  cwd?: string;
}

export interface StartSessionResult {
  session: SessionNodeWithDependencies;
  review: SessionNodeWithDependencies;
}
