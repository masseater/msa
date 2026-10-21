import { deepStrictEqual, doesNotThrow, strictEqual } from "node:assert/strict";

import { Effect } from "effect";

import type contextTypes from "../context.ts";
import support from "./support.ts";
import type supportTypes from "./support.types.ts";

const { findSpan, recordedSpans, rejectWith, rejectsWithSameValue, unreadable } = support;

const suppressesUnreadablePayloads: supportTypes.ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    let calls = 0;
    const options = unreadable<contextTypes.SpanOptions>({
      attributes: { secret: "value" },
      name: "unreadable-options",
    });
    const result = fixture.context.startSpan(options, () => {
      calls++;
      return 9;
    });

    strictEqual(calls, 1);
    strictEqual(yield* Effect.promise(() => result), 9);
    deepStrictEqual(yield* recordedSpans(fixture), []);

    yield* Effect.promise(() =>
      fixture.context.startSpan({ name: "unreadable-recording" }, (span) => {
        const attributes = unreadable<contextTypes.SpanAttributes>({ secret: "value" });
        const status = unreadable<contextTypes.SpanStatus>({ status: "ok" });
        doesNotThrow(() => span.setAttributes(attributes));
        doesNotThrow(() => span.addEvent("unreadable-event", attributes));
        doesNotThrow(() => span.setStatus(status));
      }),
    );

    const recorded = yield* recordedSpans(fixture);
    strictEqual(recorded.length, 1);
    deepStrictEqual(recorded[0]?.attributes, {});
    deepStrictEqual(recorded[0]?.events, []);
    deepStrictEqual(recorded[0]?.status, { status: "ok" });
  });

const ignoresFailedStatus: supportTypes.ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    const rejection = new Error("rejected after unreadable status");
    yield* rejectsWithSameValue(
      () =>
        fixture.context.startSpan({ name: "unreadable-status" }, (span) => {
          const status = unreadable<contextTypes.SpanStatus>({ status: "ok" });
          doesNotThrow(() => span.setStatus(status));
          return rejectWith(rejection);
        }),
      rejection,
    );

    strictEqual(
      findSpan(yield* recordedSpans(fixture), "unreadable-status").status.status,
      "error",
    );
  });

const passivityCases: readonly supportTypes.ConformanceCaseDefinition[] = [
  {
    group: "passivity",
    name: "suppresses unreadable telemetry payload failures",
    test: suppressesUnreadablePayloads,
  },
  {
    group: "passivity",
    name: "ignores failed status calls atomically",
    test: ignoresFailedStatus,
  },
];

const passivityCasesModule = {
  passivityCases,
};

export default passivityCasesModule;
