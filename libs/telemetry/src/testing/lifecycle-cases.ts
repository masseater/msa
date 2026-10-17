import { deepStrictEqual, strictEqual } from "node:assert/strict";

import { Effect } from "effect";

import type { ConformanceCaseDefinition, ConformanceTest } from "./support.ts";
import {
  findSpan,
  recordedSpans,
  rejectsWithSameValue,
  rejectWith,
  unreadable,
} from "./support.ts";

const admitsOnce: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    let admitted = false;
    let calls = 0;
    const expected = { value: 42 };
    const result = fixture.context.startSpan({ name: "success" }, () => {
      admitted = true;
      calls++;
      return expected;
    });

    strictEqual(admitted, true);
    strictEqual(calls, 1);
    strictEqual(yield* Effect.promise(() => result), expected);
    deepStrictEqual(findSpan(yield* recordedSpans(fixture), "success").status, { status: "ok" });
    strictEqual(findSpan(yield* recordedSpans(fixture), "success").settled, true);
  });

const preservesReadableRejections: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    const syncError = new Error("sync");
    yield* rejectsWithSameValue(
      () =>
        fixture.context.startSpan({ name: "sync-error" }, () => {
          throw syncError;
        }),
      syncError,
    );

    const asyncError = { kind: "async" };
    yield* rejectsWithSameValue(
      () => fixture.context.startSpan({ name: "async-error" }, () => rejectWith(asyncError)),
      asyncError,
    );

    yield* rejectsWithSameValue(
      () => fixture.context.startSpan({ name: "undefined-error" }, () => rejectWith(undefined)),
      undefined,
    );
  });

const preservesUnreadableRejections: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    const unreadableError = unreadable({ kind: "unreadable" });
    yield* rejectsWithSameValue(
      () =>
        fixture.context.startSpan({ name: "unreadable-error" }, () => {
          throw unreadableError;
        }),
      unreadableError,
    );

    const asyncUnreadableError = unreadable({ kind: "async-unreadable" });
    yield* rejectsWithSameValue(
      () =>
        fixture.context.startSpan({ name: "async-unreadable-error" }, () =>
          rejectWith(asyncUnreadableError),
        ),
      asyncUnreadableError,
    );
  });

const preservesRejections: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    yield* preservesReadableRejections(fixture);
    yield* preservesUnreadableRejections(fixture);

    const spans = yield* recordedSpans(fixture);
    for (const name of [
      "sync-error",
      "async-error",
      "undefined-error",
      "unreadable-error",
      "async-unreadable-error",
    ]) {
      strictEqual(findSpan(spans, name).status.status, "error");
    }
  });

const expectedFailureStatus = {
  status: "error",
  error: { name: "Expected", message: "async failure" },
} as const;

const returnedFailureStatus = {
  status: "error",
  error: { name: "Expected", message: "returned failure" },
} as const;

const recordExplicitStatuses: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      fixture.context.startSpan({ name: "last-status" }, (span) => {
        span.setStatus({ status: "error", error: { name: "Expected", message: "first" } });
        span.setStatus({ status: "ok" });
      }),
    );

    const thrown = new Error("after explicit status");
    yield* rejectsWithSameValue(
      () =>
        fixture.context.startSpan({ name: "explicit-before-throw" }, (span) => {
          span.setStatus({ status: "ok" });
          throw thrown;
        }),
      thrown,
    );

    const rejected = new Error("after async explicit status");
    yield* rejectsWithSameValue(
      () =>
        fixture.context.startSpan({ name: "explicit-before-rejection" }, (span) => {
          span.setStatus(expectedFailureStatus);
          return rejectWith(rejected);
        }),
      rejected,
    );

    yield* Effect.promise(() =>
      fixture.context.startSpan({ name: "expected-failure" }, (span) => {
        span.setStatus(returnedFailureStatus);
        return { ok: false };
      }),
    );
  });

const usesLastExplicitStatus: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    yield* recordExplicitStatuses(fixture);

    const spans = yield* recordedSpans(fixture);
    deepStrictEqual(findSpan(spans, "last-status").status, { status: "ok" });
    deepStrictEqual(findSpan(spans, "explicit-before-throw").status, { status: "ok" });
    deepStrictEqual(findSpan(spans, "explicit-before-rejection").status, expectedFailureStatus);
    deepStrictEqual(findSpan(spans, "expected-failure").status, returnedFailureStatus);
  });

export const lifecycleCases: readonly ConformanceCaseDefinition[] = [
  {
    group: "callback lifecycle",
    name: "admits once synchronously and preserves the result",
    test: admitsOnce,
  },
  {
    group: "callback lifecycle",
    name: "preserves synchronous and asynchronous rejection values",
    test: preservesRejections,
  },
  {
    group: "status",
    name: "uses last explicit status without automatic overwrite",
    test: usesLastExplicitStatus,
  },
];
