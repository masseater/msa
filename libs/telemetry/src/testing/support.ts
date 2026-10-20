import { fail, ok, strictEqual } from "node:assert/strict";

import { Data, Effect } from "effect";
import { dual } from "effect/Function";

import type memoryTypes from "../memory.types.ts";
import type supportTypes from "./support.types.ts";
import type typesModule from "./types.ts";

class OperationRejected extends Data.TaggedError("OperationRejected")<{
  readonly reason: unknown;
}> {}

const createCase: {
  (
    definition: supportTypes.ConformanceCaseDefinition,
  ): (
    factory: typesModule.TelemetryAdapterFixtureFactory,
  ) => typesModule.TelemetryAdapterConformanceCase;
  (
    factory: typesModule.TelemetryAdapterFixtureFactory,
    definition: supportTypes.ConformanceCaseDefinition,
  ): typesModule.TelemetryAdapterConformanceCase;
} = dual(
  2,
  (
    factory: typesModule.TelemetryAdapterFixtureFactory,
    definition: supportTypes.ConformanceCaseDefinition,
  ): typesModule.TelemetryAdapterConformanceCase => ({
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

function recordedSpans(
  fixture: typesModule.TelemetryAdapterFixture,
): Effect.Effect<readonly memoryTypes.RecordedTelemetrySpan[]> {
  return Effect.promise(() => fixture.getSpans());
}

const findSpan: {
  (
    name: string,
  ): (spans: readonly memoryTypes.RecordedTelemetrySpan[]) => memoryTypes.RecordedTelemetrySpan;
  (
    spans: readonly memoryTypes.RecordedTelemetrySpan[],
    name: string,
  ): memoryTypes.RecordedTelemetrySpan;
} = dual(
  2,
  (
    spans: readonly memoryTypes.RecordedTelemetrySpan[],
    name: string,
  ): memoryTypes.RecordedTelemetrySpan => {
    const span = spans.find((candidate) => candidate.name === name);
    ok(span, `Expected recorded span ${name}`);
    return span;
  },
);

const rejectsWithSameValue: {
  (expected: unknown): (operation: () => Promise<unknown>) => Effect.Effect<void>;
  (operation: () => Promise<unknown>, expected: unknown): Effect.Effect<void>;
} = dual(2, (operation: () => Promise<unknown>, expected: unknown): Effect.Effect<void> =>
  Effect.tryPromise({
    catch: (reason) => new OperationRejected({ reason }),
    try: operation,
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.sync(() => strictEqual(error.reason, expected)),
      onSuccess: () => Effect.sync(() => fail("Expected operation to reject")),
    }),
  ),
);

function rejectWith(reason: unknown): Promise<never> {
  return Effect.runPromise(Effect.die(reason));
}

function unreadable<T extends object>(value: T): T {
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

const support = {
  createCase,
  findSpan,
  recordedSpans,
  rejectWith,
  rejectsWithSameValue,
  unreadable,
};

export default support;
