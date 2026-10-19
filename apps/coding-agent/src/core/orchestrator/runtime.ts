import type { DatabaseSync } from "node:sqlite";

import { DateTime, Effect } from "effect";

import type { OrchestratorTelemetry } from "./telemetry.ts";
import type { OrchestratorOptions, WorkerSession } from "./worker.ts";
import type { WrapUp } from "./wrap-up.ts";

export interface Runtime {
  database: DatabaseSync;
  options: OrchestratorOptions;
  telemetry: OrchestratorTelemetry;
  workers: Map<string, WorkerSession>;
  runs: Map<string, number>;
  runStartedAt: Map<string, number>;
  wrapUps: Map<string, WrapUp>;
  replanning: boolean;
  maxConcurrentSessions: number;
  nextRun(): number;
  exclusive<A>(effect: Effect.Effect<A, unknown>): Promise<A>;
  publish(): void;
  settle(sessionId: string, run: number, worker: WorkerSession, error: unknown): Promise<void>;
  afterTurn(sessionId: string, run: number, worker: WorkerSession): void;
}

export const nowMillis: Effect.Effect<number> = Effect.map(DateTime.now, DateTime.toEpochMillis);
