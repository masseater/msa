import { dual } from "effect/Function";
import { expect } from "vite-plus/test";

import { applyImmutable, diffRevisions } from "../../src/delta/index.ts";
import type { JsonValue } from "../../src/json.ts";

function expectDiffImpl(before: JsonValue, after: JsonValue, expected: unknown): void {
  const operations = diffRevisions(before, after);
  expect(operations).toEqual(expected);
  expect(applyImmutable(before, operations)).toEqual(after);
}

const expectDiff: {
  (after: JsonValue, expected: unknown): (before: JsonValue) => void;
  (before: JsonValue, after: JsonValue, expected: unknown): void;
} = dual(3, expectDiffImpl);

export default expectDiff;
