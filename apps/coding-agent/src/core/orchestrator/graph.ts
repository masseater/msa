import type { ThinkingLevel } from "@msa/agent-core";

export type SessionKind = "task" | "review";
export type SessionStatus = "queued" | "running" | "completed" | "failed" | "stopped";

/** A session the orchestrator started, as a node of its project's dependency graph. */
export interface SessionNode {
  id: string;
  /** The orchestrator session that owns this session. */
  project: string;
  kind: SessionKind;
  title: string;
  prompt: string;
  status: SessionStatus;
  /** `provider/id` */
  model: string;
  thinkingLevel: ThinkingLevel;
  cwd: string;
  /** Sessions of one round end in the round's review. */
  round: number;
  createdAt: number;
  sessionFile?: string;
  report?: string;
  /** Messages sent while the session waited; they join the prompt when it starts. */
  pendingMessages: string[];
}

export interface SessionNodeWithDependencies extends SessionNode {
  dependsOn: string[];
}

export type SessionNodePatch = {
  [K in "status" | "model" | "thinkingLevel" | "sessionFile" | "report" | "pendingMessages"]?:
    | SessionNode[K]
    | undefined;
};

/** Storage of the sessions an orchestrator started and the `DEPENDS_ON` edges between them. */
export interface SessionGraph {
  /** Rejects dependencies that are not sessions of the same project. */
  add(node: SessionNode, dependsOn: readonly string[]): Promise<void>;
  update(id: string, patch: SessionNodePatch): Promise<void>;
  /** Replaces the outgoing `DEPENDS_ON` edges of `id`. */
  setDependencies(id: string, dependsOn: readonly string[]): Promise<void>;
  get(id: string): Promise<SessionNodeWithDependencies | undefined>;
  list(project: string): Promise<SessionNodeWithDependencies[]>;
  /** Queued sessions of the project whose dependencies have all completed. */
  ready(project: string): Promise<SessionNode[]>;
  /** Tasks of the round that no other non-stopped task of the round depends on. */
  sinks(project: string, round: number): Promise<string[]>;
  close(): Promise<void>;
}
