import { fail, ok, strictEqual } from "node:assert/strict";

import { Data, Effect } from "effect";
import { dual } from "effect/Function";

import type { RecordedTelemetrySpan } from "../memory.ts";
import type {
  TelemetryAdapterConformanceCase,
  TelemetryAdapterFixture,
  TelemetryAdapterFixtureFactory,
} from "./types.ts";

export type ConformanceTest = (fixture: TelemetryAdapterFixture) => Effect.Effect<void>;

export interface ConformanceCaseDefinition {
  readonly group: string;
  readonly name: string;
  readonly test: ConformanceTest;
}

class OperationRejected extends Data.TaggedError("OperationRejected")<{
  readonly reason: unknown;
}> {}

export const createCase: {
  (
    definition: ConformanceCaseDefinition,
  ): (factory: TelemetryAdapterFixtureFactory) => TelemetryAdapterConformanceCase;
  (
    factory: TelemetryAdapterFixtureFactory,
    definition: ConformanceCaseDefinition,
  ): TelemetryAdapterConformanceCase;
} = dual(
  2,
  (
    factory: TelemetryAdapterFixtureFactory,
    definition: ConformanceCaseDefinition,
  ): TelemetryAdapterConformanceCase => ({
    group: definition.group,
    name: definition.name,
    run: () =>
      Effect.runPromise(
        Effect.acquireUseRelease(
          Effect.promise(() => factory()),
          definition.test,
          (fixture) => Effect.promise(() => fixture[Symbol.asyncDispose]()),
        ),
      ),
  }),
);

export function recordedSpans(
  fixture: TelemetryAdapterFixture,
): Effect.Effect<readonly RecordedTelemetrySpan[]> {
  return Effect.promise(() => fixture.getSpans());
}

export const findSpan: {
  (name: string): (spans: readonly RecordedTelemetrySpan[]) => RecordedTelemetrySpan;
  (spans: readonly RecordedTelemetrySpan[], name: string): RecordedTelemetrySpan;
} = dual(2, (spans: readonly RecordedTelemetrySpan[], name: string): RecordedTelemetrySpan => {
  const span = spans.find((candidate) => candidate.name === name);
  ok(span, `Expected recorded span ${name}`);
  return span;
});

export const rejectsWithSameValue: {
  (expected: unknown): (operation: () => Promise<unknown>) => Effect.Effect<void>;
  (operation: () => Promise<unknown>, expected: unknown): Effect.Effect<void>;
} = dual(2, (operation: () => Promise<unknown>, expected: unknown): Effect.Effect<void> =>
  Effect.tryPromise({
    try: operation,
    catch: (reason) => new OperationRejected({ reason }),
  }).pipe(
    Effect.matchEffect({
      onSuccess: () => Effect.sync(() => fail("Expected operation to reject")),
      onFailure: (error) => Effect.sync(() => strictEqual(error.reason, expected)),
    }),
  ),
);

export function rejectWith(reason: unknown): Promise<never> {
  return Effect.runPromise(Effect.die(reason));
}

export function unreadable<T extends object>(value: T): T {
  return new Proxy(value, {
    get: () => {
      throw new Error("read");
    },
    getOwnPropertyDescriptor: () => {
      throw new Error("inspect");
    },
    getPrototypeOf: () => {
      throw new Error("prototype");
    },
    ownKeys: () => {
      throw new Error("enumerate");
    },
  });
}
