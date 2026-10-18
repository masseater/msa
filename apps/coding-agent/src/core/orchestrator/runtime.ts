import type { DatabaseSync } from "node:sqlite";

import { DateTime, Effect } from "effect";

import type { OrchestratorOptions, WorkerSession } from "./worker.ts";

export interface Runtime {
  database: DatabaseSync;
  options: OrchestratorOptions;
  workers: Map<string, WorkerSession>;
  runs: Map<string, number>;
  runStartedAt: Map<string, number>;
  maxConcurrentSessions: number;
  nextRun(): number;
  exclusive<A>(effect: Effect.Effect<A, unknown>): Promise<A>;
  publish(): void;
  settle(sessionId: string, run: number, worker: WorkerSession, error: unknown): Promise<void>;
  afterTurn(sessionId: string, run: number, worker: WorkerSession): void;
}

export const nowMillis: Effect.Effect<number> = Effect.map(DateTime.now, DateTime.toEpochMillis);
