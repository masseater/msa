import { expect } from "vite-plus/test";

import { applyImmutable, diffRevisions } from "../../src/delta/index.ts";
import type { JsonValue } from "../../src/json.ts";

export const expectDiff = (before: JsonValue, after: JsonValue, expected: unknown): void => {
  const operations = diffRevisions(before, after);
  expect(operations).toEqual(expected);
  expect(applyImmutable(before, operations)).toEqual(after);
};
