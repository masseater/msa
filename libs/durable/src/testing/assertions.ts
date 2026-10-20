import type assertionsTypes from "./assertions.types.ts";
import type typesModule from "./types.ts";

type ExpectResult = {
  toBe(expected: unknown): unknown;
  toBeGreaterThan(expected: number): unknown;
  toEqual(expected: unknown): unknown;
  toMatchObject(expected: unknown): unknown;
  toBeTruthy(): unknown;
  readonly rejects: {
    toThrow(expected?: string | RegExp): unknown;
  };
};

function createExpectAssertions(
  expect: assertionsTypes.ExpectLike,
): typesModule.StorageConformanceAssertions {
  const result = (actual: unknown, message?: string): ExpectResult =>
    expect(actual, message) as ExpectResult;
  return {
    deepEqual(actual, expected) {
      result(actual).toEqual(expected);
    },
    greaterThan(actual, expected) {
      result(actual).toBeGreaterThan(expected);
    },
    ok(value, message) {
      result(value, message).toBeTruthy();
    },
    partialDeepEqual(actual, expected) {
      result(actual).toMatchObject(expected);
    },
    rejects(operation, messageIncludes) {
      return Promise.resolve(result(operation).rejects.toThrow(messageIncludes)).then(
        () => undefined,
      );
    },
    strictEqual(actual, expected) {
      result(actual).toBe(expected);
    },
  };
}

const assertions = {
  createExpectAssertions,
};

export default assertions;
