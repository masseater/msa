import { deepStrictEqual, doesNotThrow, ok, strictEqual } from "node:assert/strict";

import { Deferred, Effect } from "effect";

import type contextTypes from "../context.ts";
import support from "./support.ts";
import type supportTypes from "./support.types.ts";

const { findSpan, recordedSpans, unreadable } = support;

const mergesAttributes: supportTypes.ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      fixture.context.startSpan(
        {
          attributes: { ignored: undefined, overwrite: "start", start: "value" },
          name: "recording",
        },
        (span) => {
          span.setAttributes({ count: 1, overwrite: "middle" });
          span.setAttributes({ count: undefined, overwrite: "end" });
          span.addEvent("first", { ignored: undefined, index: 1 });
          span.addEvent("second", { index: 2 });
        },
      ),
    );

    const span = findSpan(yield* recordedSpans(fixture), "recording");
    deepStrictEqual(span.attributes, { count: 1, overwrite: "end", start: "value" });
    deepStrictEqual(span.events, [
      { attributes: { index: 1 }, name: "first" },
      { attributes: { index: 2 }, name: "second" },
    ]);
  });

const ignoresFailedAttributes: supportTypes.ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      fixture.context.startSpan(
        { attributes: { retained: "value" }, name: "atomic-attributes" },
        (span) => {
          const attributes: contextTypes.SpanAttributes = {
            partial: "must not survive",
            unreadable: unreadable(["value"]),
          };
          doesNotThrow(() => span.setAttributes(attributes));
        },
      ),
    );

    deepStrictEqual(findSpan(yield* recordedSpans(fixture), "atomic-attributes").attributes, {
      retained: "value",
    });
  });

const settledSpan = (
  fixture: Parameters<supportTypes.ConformanceTest>[0],
): Effect.Effect<contextTypes.TelemetrySpan> =>
  Effect.gen(function* () {
    let captured: contextTypes.TelemetrySpan | undefined;
    yield* Effect.promise(() =>
      fixture.context.startSpan({ attributes: { value: "initial" }, name: "settled" }, (span) => {
        captured = span;
      }),
    );
    if (captured === undefined) return yield* Effect.die(new Error("Expected callback span"));
    return captured;
  });

const makesSettledCallsInert: supportTypes.ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    const capturedSpan = yield* settledSpan(fixture);

    doesNotThrow(() => capturedSpan.setAttributes({ value: "late" }));
    doesNotThrow(() => capturedSpan.addEvent("late", { value: true }));
    doesNotThrow(() => capturedSpan.setStatus({ status: "error" }));
    let childAdmitted = false;
    const childResult = capturedSpan.startSpan({ name: "late-child" }, () => {
      childAdmitted = true;
      return 7;
    });
    strictEqual(childAdmitted, true);
    strictEqual(yield* Effect.promise(() => childResult), 7);

    const spans = yield* recordedSpans(fixture);
    strictEqual(spans.length, 1);
    deepStrictEqual(spans[0]?.attributes, { value: "initial" });
    deepStrictEqual(spans[0]?.events, []);
    deepStrictEqual(spans[0]?.status, { status: "ok" });
  });

const runNestedSpans = (
  fixture: Parameters<supportTypes.ConformanceTest>[0],
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context());
    const firstGate = yield* Deferred.make<void>();
    yield* Effect.promise(() =>
      fixture.context.startSpan({ name: "parent" }, (parent) =>
        runPromise(
          Effect.gen(function* () {
            const first = parent.startSpan({ name: "first-child" }, () =>
              runPromise(Deferred.await(firstGate)),
            );
            const second = parent.startSpan({ name: "second-child" }, () => "done");
            strictEqual(yield* Effect.promise(() => second), "done");
            yield* Deferred.succeed(firstGate, undefined);
            yield* Effect.promise(() => first);
          }),
        ),
      ),
    );
  });

const recordsParentage: supportTypes.ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    yield* runNestedSpans(fixture);

    const spans = yield* recordedSpans(fixture);
    const parent = findSpan(spans, "parent");
    const first = findSpan(spans, "first-child");
    const second = findSpan(spans, "second-child");
    strictEqual(parent.parentId, null);
    strictEqual(first.parentId, parent.id);
    strictEqual(second.parentId, parent.id);
    ok(
      second.endSequence !== undefined &&
        first.endSequence !== undefined &&
        parent.endSequence !== undefined,
    );
    ok(second.endSequence < first.endSequence);
    ok(first.endSequence < parent.endSequence);
  });

const recordingCases: readonly supportTypes.ConformanceCaseDefinition[] = [
  {
    group: "recording",
    name: "merges attributes and records ordered events",
    test: mergesAttributes,
  },
  {
    group: "recording",
    name: "ignores failed attribute calls atomically",
    test: ignoresFailedAttributes,
  },
  { group: "recording", name: "makes calls after settlement inert", test: makesSettledCallsInert },
  {
    group: "parentage",
    name: "records nested and concurrent child relationships",
    test: recordsParentage,
  },
];

const recordingCasesModule = {
  recordingCases,
};

export default recordingCasesModule;
