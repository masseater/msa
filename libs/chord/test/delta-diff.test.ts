import { describe, expect, it } from "vite-plus/test";

import delta from "../src/delta/index.ts";
import type deltaTypes from "../src/delta/index.types.ts";
import type jsonTypes from "../src/json.types.ts";
import expectDiff from "./fixtures/delta-diff.ts";

const { applyImmutable, decoder, diffRevisions, encoder } = delta;
const assertValidOp: typeof delta.assertValidOp = delta.assertValidOp;
const assertValidWireOp: typeof delta.assertValidWireOp = delta.assertValidWireOp;

const emitsSetsAndDeletes = (): void => {
  expectDiff({ change: 1, keep: 1, remove: true }, { add: 3, change: 2, keep: 1 }, [
    ["s", ["add"], 3],
    ["s", ["change"], 2],
    ["d", ["remove"]],
  ]);
};

const emitsStringAppendAndFrontTruncation = (): void => {
  expectDiff({ text: "hello" }, { text: "hello world" }, [["a", ["text"], " world"]]);
  expectDiff({ text: "hello world" }, { text: "world" }, [["t", ["text"], 6]]);
  expectDiff({ text: "abcdefgh" }, { text: "defghxyz" }, [
    ["t", ["text"], 3],
    ["a", ["text"], "xyz"],
  ]);
};

const representsArrayInsertionRemovalAndShift = (): void => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  expectDiff({ values: [a, b] }, { values: [a, c, b] }, [["p", ["values"], 1, 0, [c]]]);
  expectDiff({ values: [a, b, c] }, { values: [b, c] }, [["p", ["values"], 0, 1, []]]);
};

const collapsesASameLengthQueueUpdate = (): void => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  const d = { id: "d" };
  expectDiff({ values: [a, b, c] }, { values: [b, c, d] }, [
    ["p", ["values"], 0, 1, []],
    ["p", ["values"], 2, 0, [d]],
  ]);
};

const emitsAPermutationForAPure = (): void => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  expectDiff({ values: [a, b, c] }, { values: [c, a, b] }, [["m", ["values"], [2, 0, 1]]]);
};

const normalizesReorderedDistinctDeeplyEqualObjects = (): void => {
  const first = { nested: { value: 1 } };
  const second = { nested: { value: 1 } };
  expect(first).not.toBe(second);
  expect(diffRevisions({ values: [first, second] }, { values: [second, first] })).toEqual([]);
};

const validatesAndEncodesPermutations = (): void => {
  const operations: deltaTypes.Op[] = [
    ["m", ["values"], [2, 0, 1]],
    ["m", ["values"], [1, 2, 0]],
  ];
  for (const operation of operations) assertValidOp(operation);
  const wire = encoder().encode(operations);
  expect(wire).toEqual([
    ["m", ["values"], [2, 0, 1]],
    ["m", [1, 2, 0]],
  ]);
  for (const operation of wire) assertValidWireOp(operation);
  expect(decoder().decode(wire)).toEqual(operations);
  expect(() => assertValidOp(["m", ["values"], [0, 0]])).toThrow(/bijection/u);
};

const emitsNothingForDeeplyEqualReconstructed = (): void => {
  expect(diffRevisions({ value: { nested: [1, 2] } }, { value: { nested: [1, 2] } })).toEqual([]);
  expect(
    diffRevisions({ values: [{ id: 1 }, { id: 2 }] }, { values: [{ id: 1 }, { id: 2 }] }),
  ).toEqual([]);
  expect(diffRevisions({ values: [true, true, true] }, { values: [true, true, true] })).toEqual([]);
};

const keepsALeafEditInsideA = (): void => {
  expectDiff(
    {
      values: [
        { id: 1, label: "one" },
        { id: 2, label: "two" },
      ],
    },
    {
      values: [
        { id: 1, label: "one" },
        { id: 2, label: "changed" },
      ],
    },
    [["s", ["values", 1, "label"], "changed"]],
  );
};

const emitsPayloadFreeSplicesForScattered = (): void => {
  const [a, b, c, d, e] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  expectDiff({ values: [a, b, c, d, e] }, { values: [a, c, e] }, [
    ["p", ["values"], 1, 1, []],
    ["p", ["values"], 2, 1, []],
  ]);
};

const doesNotFieldDiffUnrelatedShifted = (): void => {
  const before = [1, 2, 3].map((value) => ({ type: "row", value }));
  const after = [2, 3, 4].map((value) => ({ type: "row", value }));
  expectDiff({ values: before }, { values: after }, [
    ["p", ["values"], 0, 1, []],
    ["p", ["values"], 2, 0, [{ type: "row", value: 4 }]],
  ]);
};

describe("immutable revision diff", () => {
  it("emits sets and deletes", emitsSetsAndDeletes);

  it("emits string append and front truncation", emitsStringAppendAndFrontTruncation);

  it(
    "represents array insertion, removal, and shift with splices",
    representsArrayInsertionRemovalAndShift,
  );

  it("collapses a same-length queue update to two splices", collapsesASameLengthQueueUpdate);

  it("emits a permutation for a pure reorder", emitsAPermutationForAPure);

  it(
    "normalizes reordered distinct deeply-equal objects to a no-op",
    normalizesReorderedDistinctDeeplyEqualObjects,
  );

  it("validates and encodes permutations", validatesAndEncodesPermutations);

  it(
    "emits nothing for deeply equal reconstructed values",
    emitsNothingForDeeplyEqualReconstructed,
  );

  it("keeps a leaf edit inside a reconstructed array narrow", keepsALeafEditInsideA);

  it("emits payload-free splices for scattered removals", emitsPayloadFreeSplicesForScattered);

  it.each([
    ["front", [1, 2, 3, 4], [2, 3, 4], [["p", ["values"], 0, 1, []]]],
    ["tail", [1, 2, 3, 4], [1, 2, 3], [["p", ["values"], 3, 1, []]]],
    ["middle", [1, 2, 3, 4], [1, 3, 4], [["p", ["values"], 1, 1, []]]],
    ["all", [1, 2, 3, 4], [], [["p", ["values"], 0, 4, []]]],
    ["none", [1, 2, 3, 4], [1, 2, 3, 4], []],
  ] as const)("encodes %s removal canonically", (_name, before, after, expected) => {
    expectDiff({ values: [...before] }, { values: [...after] }, expected);
  });

  it(
    "does not field-diff unrelated shifted objects with common fields",
    doesNotFieldDiffUnrelatedShifted,
  );
});

const doesNotTreatCoincidentalIdOr = (): void => {
  const left = { value: "left" };
  const right = { value: "right" };
  const before = [
    left,
    { id: 1, key: "a", value: "first" },
    { id: 2, key: "b", value: "second" },
    right,
  ];
  const replacements = [
    { id: 2, key: "b", value: "edited-second" },
    { id: 1, key: "a", value: "edited-first" },
  ];
  const after = [left, ...replacements, right];
  expectDiff({ values: before }, { values: after }, [["p", ["values"], 1, 2, replacements]]);
};

const combinesRemovalsAppendAndAShared = (): void => {
  const a = { detail: { text: "a" }, id: "a", stable: {} };
  const b = { detail: { text: "b" }, id: "b", stable: {} };
  const c = { detail: { text: "c" }, id: "c", stable: {} };
  const d = { detail: { text: "d" }, id: "d", stable: {} };
  const changedC = { detail: { text: "changed" }, id: "c", stable: c.stable };
  const appended = { detail: { text: "e" }, id: "e", stable: {} };
  expectDiff({ values: [a, b, c, d] }, { values: [a, changedC, d, appended] }, [
    ["p", ["values"], 1, 1, []],
    ["a", ["values", 1, "detail", "text"], "hanged"],
    ["p", ["values"], 3, 0, [appended]],
  ]);
};

describe("immutable revision diff", () => {
  it(
    "does not treat coincidental id or key fields as structural identity",
    doesNotTreatCoincidentalIdOr,
  );

  it(
    "combines removals, append, and a shared-subtree survivor edit",
    combinesRemovalsAppendAndAShared,
  );

  it.each([256 * 1024, 1024 * 1024])(
    "does not retain a %i-byte removed-neighbor payload",
    (size) => {
      const payload = "x".repeat(size);
      const retained = [
        { id: "a", payload },
        { id: "b", payload },
        { id: "c", payload },
        { id: "d", payload },
        { id: "e", payload },
      ];
      const before = Object.freeze({ values: Object.freeze(retained.slice()) });
      const after = Object.freeze({
        values: Object.freeze([retained[0]!, retained[2]!, retained[4]!]),
      });
      const operations = diffRevisions(
        before as unknown as jsonTypes.JsonValue,
        after as unknown as jsonTypes.JsonValue,
      );
      expect(operations).toEqual([
        ["p", ["values"], 1, 1, []],
        ["p", ["values"], 2, 1, []],
      ]);
      expect(JSON.stringify(operations).length).toBeLessThan(100);
      expect(applyImmutable(before, operations)).toEqual(after);
      expect(before.values).toEqual(retained);
    },
  );
});
