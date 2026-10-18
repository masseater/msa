import type { ThinkingLevel } from "@msa/agent-core";

export type SessionKind = "task" | "review";
export type SessionStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export interface SessionNode {
  id: string;
  project: string;
  kind: SessionKind;
  title: string;
  prompt: string;
  status: SessionStatus;
  model: string;
  thinkingLevel: ThinkingLevel;
  cwd: string;
  round: number;
  createdAt: number;
  sessionFile?: string;
  report?: string;
}

export interface SessionNodeWithDependencies extends SessionNode {
  dependsOn: string[];
}

export type SessionNodePatch = {
  [K in "status" | "model" | "thinkingLevel" | "sessionFile" | "report"]?:
    | SessionNode[K]
    | undefined;
};

export interface SessionGraph {
  add(node: SessionNode, dependsOn: readonly string[]): Promise<void>;
  update(id: string, patch: SessionNodePatch): Promise<void>;
  setDependencies(id: string, dependsOn: readonly string[]): Promise<void>;
  get(id: string): Promise<SessionNodeWithDependencies | undefined>;
  list(project: string): Promise<SessionNodeWithDependencies[]>;
  ready(project: string): Promise<SessionNode[]>;
  sinks(project: string, round: number): Promise<string[]>;
  close(): Promise<void>;
}
