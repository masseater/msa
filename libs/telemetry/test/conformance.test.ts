import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import telemetry from "../src/index.ts";
import type telemetryTypes from "../src/index.types.ts";
import testing from "../src/testing/index.ts";
import type testingTypes from "../src/testing/index.types.ts";

const { createTelemetryAdapterConformance } = testing;
const { InMemoryTelemetryContext } = telemetry;

const conformance = createTelemetryAdapterConformance(() => {
  const context = new InMemoryTelemetryContext();
  return Promise.resolve<testingTypes.TelemetryAdapterFixture>({
    [Symbol.asyncDispose]: () => Promise.resolve(),
    context,
    getLogs: () => Promise.resolve(context.getLogs()),
    getMetrics: () => Promise.resolve(context.getMetrics()),
    getSpans: () => Promise.resolve(context.getSpans()),
  });
});

const detachedSnapshots = Effect.gen(function* () {
  const context = new InMemoryTelemetryContext();
  let openSettled: boolean | undefined;
  let openEndSequence: number | undefined;
  yield* Effect.promise(() =>
    context.startSpan({ attributes: { tags: ["initial"] }, name: "snapshot" }, (span) => {
      span.addEvent("event", { value: 1 });
      const [open] = context.getSpans();
      openSettled = open?.settled;
      openEndSequence = open?.endSequence;
    }),
  );

  expect(openSettled).toBe(false);
  expect(openEndSequence).toBeUndefined();
  const [first] = context.getSpans();
  expect(first?.settled).toBe(true);
  expect(first?.endSequence).toBe(1);
  (first!.attributes as telemetryTypes.SpanAttributes)["tags"] = ["mutated"];
  (first!.events[0]!.attributes as telemetryTypes.SpanAttributes)["value"] = 2;

  const [second] = context.getSpans();
  expect(second?.attributes).toEqual({ tags: ["initial"] });
  expect(second?.events).toEqual([{ attributes: { value: 1 }, name: "event" }]);
});

describe("InMemoryTelemetryContext conformance", () => {
  for (const group of new Set(conformance.map((testCase) => testCase.group))) {
    describe(group, () => {
      for (const testCase of conformance.filter((candidate) => candidate.group === group)) {
        it(testCase.name, () => testCase.run());
      }
    });
  }

  it("returns detached snapshots without exposing mutable recording state", () =>
    Effect.runPromise(detachedSnapshots));
});
