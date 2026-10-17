import { dual } from "effect/Function";

import type { JsonValue } from "../json.ts";
import { equalJson, isContainer } from "./diff-emit.ts";

export type ArrayMatch = readonly [before: number, after: number];

type MatchCandidate = {
  before: number;
  after: number;
  previous: number;
};

const MAX_IDENTITY_CANDIDATES = 200_000;
export const MAX_SEMANTIC_CELLS = 65_536;

const valueSame = (left: JsonValue, right: JsonValue): boolean =>
  left === right || equalJson(left, right);

const lcsMatchesOf = (
  before: readonly JsonValue[],
  after: readonly JsonValue[],
  equal: (left: JsonValue, right: JsonValue) => boolean,
  maxCells: number,
): ArrayMatch[] | undefined => {
  if (before.length === 0 || after.length === 0) return [];
  if (before.length * after.length > maxCells) return undefined;
  const width = after.length + 1;
  const lengths = new Uint32Array((before.length + 1) * width);
  for (let left = before.length - 1; left >= 0; left--) {
    for (let right = after.length - 1; right >= 0; right--) {
      const at = left * width + right;
      lengths[at] = equal(before[left]!, after[right]!)
        ? lengths[(left + 1) * width + right + 1]! + 1
        : Math.max(lengths[(left + 1) * width + right]!, lengths[left * width + right + 1]!);
    }
  }
  const matches: ArrayMatch[] = [];
  let left = 0;
  let right = 0;
  while (left < before.length && right < after.length) {
    if (
      equal(before[left]!, after[right]!) &&
      lengths[left * width + right] === lengths[(left + 1) * width + right + 1]! + 1
    ) {
      matches.push([left++, right++]);
    } else if (lengths[(left + 1) * width + right]! >= lengths[left * width + right + 1]!)
      left += 1;
    else right += 1;
  }
  return matches;
};

const alignedSemantically = (left: JsonValue, right: JsonValue): boolean => {
  if (sameValue(left, right)) return true;
  if (!isContainer(left) || !isContainer(right) || Array.isArray(left) !== Array.isArray(right))
    return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.some((value, index) => isContainer(value) && value === right[index]);
  }
  const leftObject = left as Record<string, JsonValue>;
  const rightObject = right as Record<string, JsonValue>;
  for (const [key, value] of Object.entries(leftObject)) {
    if (isContainer(value) && Object.hasOwn(rightObject, key) && value === rightObject[key])
      return true;
  }
  return false;
};

const lowerBound = (values: readonly number[], value: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
};

const subsequenceOfIdentities = (
  before: readonly JsonValue[],
  beforeStart: number,
  beforeEnd: number,
  after: readonly JsonValue[],
  afterStart: number,
  afterEnd: number,
): ArrayMatch[] | undefined => {
  const beforeCount = beforeEnd - beforeStart;
  const afterCount = afterEnd - afterStart;
  const matches: ArrayMatch[] = [];
  if (afterCount < beforeCount) {
    let beforeIndex = beforeStart;
    for (let afterIndex = afterStart; afterIndex < afterEnd; afterIndex++) {
      while (beforeIndex < beforeEnd && before[beforeIndex] !== after[afterIndex]) beforeIndex += 1;
      if (beforeIndex === beforeEnd) return undefined;
      matches.push([beforeIndex++, afterIndex]);
    }
    return matches;
  }
  if (beforeCount < afterCount) {
    let afterIndex = afterStart;
    for (let beforeIndex = beforeStart; beforeIndex < beforeEnd; beforeIndex++) {
      while (afterIndex < afterEnd && before[beforeIndex] !== after[afterIndex]) afterIndex += 1;
      if (afterIndex === afterEnd) return undefined;
      matches.push([beforeIndex, afterIndex++]);
    }
    return matches;
  }
  return undefined;
};

const greedyIdentityAnchors = (
  positions: ReadonlyMap<JsonValue, readonly number[]>,
  after: readonly JsonValue[],
  afterStart: number,
  afterEnd: number,
): ArrayMatch[] => {
  const matches: ArrayMatch[] = [];
  let previous = -1;
  for (let afterIndex = afterStart; afterIndex < afterEnd; afterIndex++) {
    const candidates = positions.get(after[afterIndex]!);
    if (candidates === undefined) continue;
    const at = lowerBound(candidates, previous + 1);
    const beforeIndex = candidates[at];
    if (beforeIndex === undefined) continue;
    matches.push([beforeIndex, afterIndex]);
    previous = beforeIndex;
  }
  return matches;
};

const anchorsOfIdentities = (
  before: readonly JsonValue[],
  beforeStart: number,
  beforeEnd: number,
  after: readonly JsonValue[],
  afterStart: number,
  afterEnd: number,
): ArrayMatch[] => {
  const positions = new Map<JsonValue, number[]>();
  for (let index = beforeStart; index < beforeEnd; index++) {
    const value = before[index]!;
    const existing = positions.get(value);
    if (existing === undefined) positions.set(value, [index]);
    else existing.push(index);
  }
  let candidateCount = 0;
  for (let index = afterStart; index < afterEnd; index++) {
    candidateCount += positions.get(after[index]!)?.length ?? 0;
    if (candidateCount > MAX_IDENTITY_CANDIDATES) {
      return greedyIdentityAnchors(positions, after, afterStart, afterEnd);
    }
  }
  if (candidateCount === 0) return [];

  return patienceMatches(positions, after, afterStart, afterEnd);
};

const patienceMatches = (
  positions: ReadonlyMap<JsonValue, number[]>,
  after: readonly JsonValue[],
  afterStart: number,
  afterEnd: number,
): ArrayMatch[] => {
  const candidates: MatchCandidate[] = [];
  const tails: number[] = [];
  const tailValues: number[] = [];
  for (let afterIndex = afterStart; afterIndex < afterEnd; afterIndex++) {
    const beforePositions = positions.get(after[afterIndex]!);
    if (beforePositions === undefined) continue;
    for (let index = beforePositions.length - 1; index >= 0; index--) {
      const beforeIndex = beforePositions[index]!;
      const at = lowerBound(tailValues, beforeIndex);
      const candidateIndex = candidates.length;
      candidates.push({
        before: beforeIndex,
        after: afterIndex,
        previous: at === 0 ? -1 : tails[at - 1]!,
      });
      tails[at] = candidateIndex;
      tailValues[at] = beforeIndex;
    }
  }
  const matches: ArrayMatch[] = [];
  let candidateIndex = tails[tails.length - 1] ?? -1;
  while (candidateIndex >= 0) {
    const candidate = candidates[candidateIndex]!;
    matches.push([candidate.before, candidate.after]);
    candidateIndex = candidate.previous;
  }
  matches.reverse();
  return matches;
};

export const sameValue: {
  (right: JsonValue): (left: JsonValue) => boolean;
  (left: JsonValue, right: JsonValue): boolean;
} = dual(2, valueSame);

export const lcsMatches: {
  (
    after: readonly JsonValue[],
    equal: (left: JsonValue, right: JsonValue) => boolean,
    maxCells: number,
  ): (before: readonly JsonValue[]) => ArrayMatch[] | undefined;
  (
    before: readonly JsonValue[],
    after: readonly JsonValue[],
    equal: (left: JsonValue, right: JsonValue) => boolean,
    maxCells: number,
  ): ArrayMatch[] | undefined;
} = dual(4, lcsMatchesOf);

export const semanticallyAligned: {
  (right: JsonValue): (left: JsonValue) => boolean;
  (left: JsonValue, right: JsonValue): boolean;
} = dual(2, alignedSemantically);

export const identitySubsequence: {
  (
    beforeStart: number,
    beforeEnd: number,
    after: readonly JsonValue[],
    afterStart: number,
    afterEnd: number,
  ): (before: readonly JsonValue[]) => ArrayMatch[] | undefined;
  (
    before: readonly JsonValue[],
    beforeStart: number,
    beforeEnd: number,
    after: readonly JsonValue[],
    afterStart: number,
    afterEnd: number,
  ): ArrayMatch[] | undefined;
} = dual(6, subsequenceOfIdentities);

export const identityAnchors: {
  (
    beforeStart: number,
    beforeEnd: number,
    after: readonly JsonValue[],
    afterStart: number,
    afterEnd: number,
  ): (before: readonly JsonValue[]) => ArrayMatch[];
  (
    before: readonly JsonValue[],
    beforeStart: number,
    beforeEnd: number,
    after: readonly JsonValue[],
    afterStart: number,
    afterEnd: number,
  ): ArrayMatch[];
} = dual(6, anchorsOfIdentities);
