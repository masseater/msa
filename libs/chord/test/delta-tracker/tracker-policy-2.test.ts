import { describe, expect, it } from "vite-plus/test";

import { track } from "../../src/delta/index.ts";
import { replay, settle } from "../fixtures/tracker.ts";

const coercingToOne = (values: number[]) =>
  ({
    valueOf() {
      values.push(4);
      return 1;
    },
  }) as unknown as number;

const compareWithNative = (mutate: (values: number[]) => void): void => {
  const native = [1, 2, 3];
  mutate(native);
  const tracker = track({ values: [1, 2, 3] });
  settle(tracker, (draft) => mutate(draft.values));
  expect(tracker.value.values).toEqual(native);
};

const matchesNativeStructuralCoercionOrderingFor = (): void => {
  compareWithNative((values) => {
    values.splice(coercingToOne(values), 1, 9);
  });
  compareWithNative((values) => {
    values.fill(7, coercingToOne(values));
  });
  compareWithNative((values) => {
    values.copyWithin(coercingToOne(values), 0, 2);
  });
};

const doesNotReportInheritedMethodsAs = (): void => {
  const tracker = track({ values: [1] });
  const change = tracker.beginChange();
  expect(Object.getOwnPropertyDescriptor(change.state.values, "map")).toBeUndefined();
  change.abort();
};

const keepsRepeatedIdenticalWritesInsteadOf = (): void => {
  const tracker = track({ value: 0, values: [0] as Array<number | null> });
  settle(tracker, (draft) => {
    draft.value = 1;
    draft.value = 1;
    draft.values[0] = null;
    draft.values[0] = null;
    draft.values.push(2);
    draft.values[1] = null;
    draft.values[1] = null;
  });
  expect(tracker.value).toEqual({ value: 1, values: [null, null] });
};

const rejectsArrayIndexGapsWithoutMutation = (): void => {
  const tracker = track({ values: [1, 2] });
  const change = tracker.beginChange();
  expect(() => {
    change.state.values[3] = 4;
  }).toThrow(/holes/u);
  expect(change.state.values).toEqual([1, 2]);
  expect(tracker.value.values).toEqual([1, 2]);

  change.state.values[1] = 9;
  change.state.values[2] = 3;
  const prepared = change.prepare();
  expect(prepared.value.values).toEqual([1, 9, 3]);
  expect(replay(tracker.value, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
  expect(tracker.value.values).toEqual([1, 9, 3]);
};

const supportsOptionalDeletionExplicitNullLength = (): void => {
  const tracker = track({
    optional: "remove" as string | undefined,
    values: [3, 1, 2] as Array<number | null>,
  });
  settle(tracker, (draft) => {
    draft.optional = undefined;
    draft.values.length = 5;
    expect(draft.values).toEqual([3, 1, 2, null, null]);
    draft.values.length = 4;
    draft.values.sort();
    expect(() => delete draft.values[0]).toThrow(/holes/u);
  });
  expect(tracker.value).toEqual({ values: [1, 2, 3, null] });
};

const enumeratesWideObjectsWithoutDuplicateKeys = (): void => {
  const tracker = track({ values: {} as Record<string, number> });
  const change = tracker.beginChange();
  for (let index = 0; index < 20_000; index++) change.state.values[`field${index}`] = index;
  const keys = Object.keys(change.state.values);
  expect(keys).toHaveLength(20_000);
  expect(keys[0]).toBe("field0");
  expect(keys.at(-1)).toBe("field19999");
  change.abort();
};

const doesNotDirtyReadOnlyTraversals = (): void => {
  const tracker = track({ nested: { rows: [{ value: 1 }] } });
  const change = tracker.beginChange();
  expect(change.state.nested.rows[0]!.value).toBe(1);
  const prepared = change.prepare();
  expect(prepared.ops).toEqual([]);
  tracker.adopt(prepared);
};

const usesOneProxyIdentityPerAccessed = (): void => {
  const tracker = track({ nested: { value: 1 }, rows: [{ value: 2 }] });
  const change = tracker.beginChange();
  expect(change.state.nested).toBe(change.state.nested);
  expect(change.state.rows).toBe(change.state.rows);
  expect(change.state.rows[0]).toBe(change.state.rows[0]);
  change.abort();
};

describe("delta tracker policy view", () => {
  it(
    "matches native structural coercion ordering for splice, fill, and copyWithin",
    matchesNativeStructuralCoercionOrderingFor,
  );

  it("does not report inherited methods as own array properties", doesNotReportInheritedMethodsAs);

  it(
    "keeps repeated identical writes instead of reverting their pending override",
    keepsRepeatedIdenticalWritesInsteadOf,
  );

  it(
    "rejects array index gaps without mutation while allowing replacement and append",
    rejectsArrayIndexGapsWithoutMutation,
  );

  it(
    "supports optional deletion, explicit null length growth, shrinking, and default sort",
    supportsOptionalDeletionExplicitNullLength,
  );

  it("enumerates wide objects without duplicate keys", enumeratesWideObjectsWithoutDuplicateKeys);

  it("does not dirty read-only traversals", doesNotDirtyReadOnlyTraversals);

  it("uses one proxy identity per accessed container", usesOneProxyIdentityPerAccessed);
});
