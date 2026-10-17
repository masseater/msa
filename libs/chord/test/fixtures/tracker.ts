import { isProxy } from "node:util/types";

import { dual } from "effect/Function";
import { expect } from "vite-plus/test";

import { apply, type Draft, type Op, track } from "../../src/delta/index.ts";

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function replayImpl<T>(base: T, operations: readonly Op[]): T {
  return apply(clone(base), clone(operations));
}

export function expectAliasFree(value: unknown): void {
  const seen = new WeakMap<object, string>();
  const visit = (current: unknown, path: string): void => {
    if (current === null || typeof current !== "object") return;
    const previous = seen.get(current);
    if (previous !== undefined) throw new Error(`container at ${path} aliases ${previous}`);
    seen.set(current, path);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index++)
        visit(current[index], `${path}[${index}]`);
      return;
    }
    for (const key of Object.keys(current))
      visit((current as Record<string, unknown>)[key], `${path}.${key}`);
  };
  visit(value, "$root");
}

function settleImpl<T extends object>(
  tracker: ReturnType<typeof track<T>>,
  mutate: (draft: Draft<T>) => void,
): T {
  const baseRoot = tracker.value;
  const base = clone(baseRoot);
  const change = tracker.beginChange();
  mutate(change.state);
  const prepared = change.prepare();
  const candidate = clone(prepared.value);
  expect(isProxy(prepared.value)).toBe(false);
  expect(replayImpl(base, prepared.ops)).toEqual(candidate);
  expect(baseRoot).toEqual(base);
  tracker.adopt(prepared);
  expect(baseRoot).toEqual(base);
  expect(tracker.value).toBe(prepared.value);
  expect(tracker.value).toEqual(candidate);
  return candidate;
}

export const replay: {
  (operations: readonly Op[]): <T>(base: T) => T;
  <T>(base: T, operations: readonly Op[]): T;
} = dual(2, replayImpl);

export const settle: {
  <T extends object>(
    mutate: (draft: Draft<T>) => void,
  ): (tracker: ReturnType<typeof track<T>>) => T;
  <T extends object>(tracker: ReturnType<typeof track<T>>, mutate: (draft: Draft<T>) => void): T;
} = dual(2, settleImpl);
