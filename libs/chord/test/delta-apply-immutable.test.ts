import { describe, expect, it } from "vite-plus/test";

import {
  type Op,
  PathError,
  UnsafePathError,
  apply,
  applyImmutable,
  applyImmutableBatches,
  track,
} from "../src/delta/index.ts";
import deltaApplyImmutable from "./fixtures/delta-apply-immutable.ts";

const { clone, freezeDeep } = deltaApplyImmutable;

const touchedContainers = () => {
  const shared = freezeDeep({ nested: { value: 1 } });
  const untouched = freezeDeep({ value: 9 });
  const rowPayload = freezeDeep({ id: 4, label: "placed" });
  const base = freezeDeep({
    branch: { value: 1 },
    copy: null as { value: number } | null,
    left: null as typeof shared | null,
    meta: { count: 0, obsolete: true },
    placed: null as typeof shared | null,
    right: null as typeof shared | null,
    rows: [
      { id: 1, label: "one" },
      { id: 2, label: "two" },
      { id: 3, label: "three" },
    ],
    stable: { value: 7 },
    text: "abcdef",
    untouched: null as typeof untouched | null,
  });
  return { base, rowPayload, shared, untouched };
};

const copiesEachTouchedContainerOnceWhile = (): void => {
  const { shared, untouched, rowPayload, base } = touchedContainers();
  const operations = freezeDeep([
    ["t", ["text"], 2],
    ["a", ["text"], "!"],
    ["s", ["meta", "count"], 1],
    ["s", ["meta", "count"], 2],
    ["d", ["meta", "obsolete"]],
    ["s", ["copy"], base.branch],
    ["s", ["copy", "value"], 2],
    ["s", ["placed"], shared],
    ["s", ["placed", "nested", "value"], 2],
    ["s", ["untouched"], untouched],
    ["s", ["left"], shared],
    ["s", ["right"], shared],
    ["s", ["left", "nested", "value"], 3],
    ["p", ["rows"], 1, 1, [rowPayload]],
    ["s", ["rows", 1, "label"], "edited"],
    ["m", ["rows"], [1, 0, 2]],
    ["s", ["rows", 0, "label"], "moved"],
  ] satisfies Op[]);

  const result = applyImmutable(base, operations);
  const mutableResult = apply(clone(base), clone(operations));

  expect(result).toEqual(mutableResult);
  expect(result.text).toBe("cdef!");
  expect(result.stable).toBe(base.stable);
  expect(result.untouched).toBe(untouched);
  expect(result.copy).not.toBe(base.branch);
  expect(result.copy).toEqual({ value: 2 });
  expect(result.placed).not.toBe(shared);
  expect(result.placed).toEqual({ nested: { value: 2 } });
  expect(result.left).not.toBe(shared);
  expect(result.right).toBe(shared);
  expect(result.rows[0]).not.toBe(rowPayload);
  expect(result.rows[0]).toEqual({ id: 4, label: "moved" });
  expect(base.branch.value).toBe(1);
  expect(shared.nested.value).toBe(1);
  expect(rowPayload.label).toBe("placed");
};

const protectsRootReplacementPayloadsBeforeLater = (): void => {
  const replacement = freezeDeep({ nested: { value: 1 }, values: [1, 2, 3] });
  const result = applyImmutableBatches<typeof replacement>(undefined, [
    [["r", replacement]],
    [["s", ["nested", "value"], 2]],
    [
      ["p", ["values"], 1, 1, [4, 5]],
      ["m", ["values"], [3, 0, 1, 2]],
    ],
  ]);
  expect(result).toEqual({ nested: { value: 2 }, values: [3, 1, 4, 5] });
  expect(replacement).toEqual({ nested: { value: 1 }, values: [1, 2, 3] });

  const array = freezeDeep([1, 2, 3]);
  const arrayResult = applyImmutable<number[]>(array, [
    ["p", [], 1, 1, [4, 5]],
    ["m", [], [3, 0, 1, 2]],
    ["d", [1]],
  ]);
  expect(arrayResult).toEqual([3, 4, 5]);
  expect(array).toEqual([1, 2, 3]);
};

const sharesOnePrivateCopyOnWrite = (): void => {
  const base = freezeDeep({
    meta: { count: 0 },
    text: "abcdef",
    values: [
      { id: 1, value: 1 },
      { id: 2, value: 2 },
      { id: 3, value: 3 },
    ],
  });
  const batches = [
    [
      ["s", ["meta", "count"], 1],
      ["p", ["values"], 1, 1, [{ id: 4, value: 4 }]],
    ] satisfies Op[],
    [] satisfies Op[],
    [
      ["m", ["values"], [2, 0, 1]],
      ["s", ["values", 2, "value"], 40],
    ] satisfies Op[],
    [
      ["t", ["text"], 2],
      ["a", ["text"], "!"],
    ] satisfies Op[],
  ];

  const [firstBatch, ...laterBatches] = batches;
  if (firstBatch === undefined) throw new Error("Expected a first batch");
  const intermediate = applyImmutable(base, firstBatch);
  const intermediateSnapshot = clone(intermediate);
  let sequential = intermediate;
  for (const batch of laterBatches) sequential = applyImmutable(sequential, batch);
  const streamed = applyImmutableBatches(base, batches);
  const flattened = applyImmutable(base, batches.flat());

  expect(streamed).toEqual(sequential);
  expect(streamed).toEqual(flattened);
  expect(intermediate).toEqual(intermediateSnapshot);
  expect(base.meta.count).toBe(0);
  expect(base.values[1]!.id).toBe(2);
};

const handlesTrackerProducedBatchesAcrossArbitrary = (): void => {
  type Document = { text: string; values: { id: number; score: number }[]; revision: number };
  const initial: Document = {
    revision: 0,
    text: "start",
    values: Array.from({ length: 8 }, (_, id) => ({ id, score: 0 })),
  };
  const tracker = track(initial);
  const batches: Array<readonly Op[]> = [];
  for (let revision = 1; revision <= 40; revision++) {
    const change = tracker.beginChange();
    change.state.revision = revision;
    change.state.text = `${change.state.text.slice(1)}${revision}`;
    switch (revision % 5) {
      case 0:
        change.state.values.reverse();
        break;
      case 1:
        change.state.values.push({ id: 100 + revision, score: revision });
        break;
      case 2:
        change.state.values.shift();
        break;
      case 3:
        change.state.values[revision % change.state.values.length]!.score = revision;
        break;
      default:
        change.state.values.splice(1, 1, { id: 200 + revision, score: revision });
    }
    const prepared = change.prepare();
    batches.push(prepared.ops);
    tracker.adopt(prepared);
  }

  expect(applyImmutableBatches(initial, batches)).toEqual(tracker.value);
};

const rejectsMalformedPathsWithoutReading = (): void => {
  let reads = 0;
  const target = Object.defineProperty({}, "trap", {
    enumerable: true,
    get() {
      reads++;
      return {};
    },
  });
  const malformed: Op[] = [["s", "bad-path", 1] as never];
  expect(() => applyImmutableBatches(target, [malformed])).toThrow(/path/u);
  expect(reads).toBe(0);

  expect(() => applyImmutable({ values: [] }, [["s", ["values", "missing", "value"], 1]])).toThrow(
    PathError,
  );
  expect(() => applyImmutable({ values: [{}] }, [["s", ["values", "0", "value"], 1]])).toThrow(
    UnsafePathError,
  );
};

const doesNotExposePartialApplicationWhen = (): void => {
  const base = freezeDeep({ nested: { value: 1 } });
  const invalidBatches: readonly (readonly Op[])[] = [
    [["s", ["nested", "value"], 2]],
    [["s", ["constructor", "prototype", "polluted"], true]],
  ];
  expect(() => applyImmutableBatches(base, invalidBatches)).toThrow();
  expect(base.nested.value).toBe(1);
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

  function* throwingBatches(): Generator<readonly Op[]> {
    yield [["s", ["nested", "value"], 3]];
    throw new Error("revision stream failed");
  }
  expect(() => applyImmutableBatches(base, throwingBatches())).toThrow("revision stream failed");
  expect(base.nested.value).toBe(1);

  let advancedPastInvalid = false;
  let iteratorClosed = false;
  function* invalidOperationBatches(): Generator<readonly Op[]> {
    try {
      yield [["s", ["nested", "value"], 4]];
      yield [["s", ["__proto__", "polluted"], true]];
      advancedPastInvalid = true;
    } finally {
      iteratorClosed = true;
    }
  }
  expect(() => applyImmutableBatches(base, invalidOperationBatches())).toThrow(UnsafePathError);
  expect(advancedPastInvalid).toBe(false);
  expect(iteratorClosed).toBe(true);
  expect(base.nested.value).toBe(1);

  rejectsMalformedPathsWithoutReading();
};

describe("checked immutable operation application", () => {
  it(
    "copies each touched container once while preserving input and payload ownership",
    copiesEachTouchedContainerOnceWhile,
  );

  it(
    "protects root replacement payloads before later object and array edits",
    protectsRootReplacementPayloadsBeforeLater,
  );

  it("shares one private copy-on-write scope across batch partitions", sharesOnePrivateCopyOnWrite);

  it(
    "handles tracker-produced batches across arbitrary revision boundaries",
    handlesTrackerProducedBatchesAcrossArbitrary,
  );

  it(
    "does not expose partial application when validation or iteration fails",
    doesNotExposePartialApplicationWhen,
  );
});
