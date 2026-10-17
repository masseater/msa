import { deepStrictEqual, doesNotThrow, strictEqual } from "node:assert/strict";

import { Effect } from "effect";

import type { SpanAttributes, SpanOptions, SpanStatus } from "../context.ts";
import type { ConformanceCaseDefinition, ConformanceTest } from "./support.ts";
import {
  findSpan,
  recordedSpans,
  rejectsWithSameValue,
  rejectWith,
  unreadable,
} from "./support.ts";

const suppressesUnreadablePayloads: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    let calls = 0;
    const options = unreadable<SpanOptions>({
      name: "unreadable-options",
      attributes: { secret: "value" },
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
        const attributes = unreadable<SpanAttributes>({ secret: "value" });
        const status = unreadable<SpanStatus>({ status: "ok" });
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

const ignoresFailedStatus: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    const rejection = new Error("rejected after unreadable status");
    yield* rejectsWithSameValue(
      () =>
        fixture.context.startSpan({ name: "unreadable-status" }, (span) => {
          const status = unreadable<SpanStatus>({ status: "ok" });
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

export const passivityCases: readonly ConformanceCaseDefinition[] = [
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
