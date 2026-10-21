import { dual } from "effect/Function";
import { expect } from "vite-plus/test";

import delta from "../../src/delta/index.ts";
import type jsonTypes from "../../src/json.types.ts";

const { applyImmutable, diffRevisions } = delta;

function expectDiffImpl(
  before: jsonTypes.JsonValue,
  after: jsonTypes.JsonValue,
  expected: unknown,
): void {
  const operations = diffRevisions(before, after);
  expect(operations).toEqual(expected);
  expect(applyImmutable(before, operations)).toEqual(after);
}

const expectDiff: {
  (after: jsonTypes.JsonValue, expected: unknown): (before: jsonTypes.JsonValue) => void;
  (before: jsonTypes.JsonValue, after: jsonTypes.JsonValue, expected: unknown): void;
} = dual(3, expectDiffImpl);

export default expectDiff;
