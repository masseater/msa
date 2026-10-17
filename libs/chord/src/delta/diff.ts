import { dual } from "effect/Function";

import type { JsonValue } from "../json.ts";
import { jsonCost, operationCost } from "./diff-cost.ts";
import {
  emitOperation,
  emitSet,
  emitString,
  equalJson,
  isContainer,
  overflowed,
  permutation,
} from "./diff-emit.ts";
import {
  type ArrayMatch,
  identityAnchors,
  identitySubsequence,
  lcsMatches,
  MAX_SEMANTIC_CELLS,
  sameValue,
  semanticallyAligned,
} from "./diff-match.ts";
import { type NonEmptyPath, type Op, type Path, RESERVED_SEGMENTS } from "./ops.ts";

interface Region {
  readonly before: JsonValue[];
  readonly after: JsonValue[];
  readonly path: Path;
  readonly operations: Op[];
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
  outputStart: number;
}

const trimEqualEnds = (region: Region): void => {
  const { before, after } = region;
  while (
    region.beforeStart < region.beforeEnd &&
    region.afterStart < region.afterEnd &&
    sameValue(before[region.beforeStart]!, after[region.afterStart]!)
  ) {
    region.beforeStart += 1;
    region.afterStart += 1;
    region.outputStart += 1;
  }
  while (
    region.beforeStart < region.beforeEnd &&
    region.afterStart < region.afterEnd &&
    sameValue(before[region.beforeEnd - 1]!, after[region.afterEnd - 1]!)
  ) {
    region.beforeEnd -= 1;
    region.afterEnd -= 1;
  }
};

const positionalMatches = (region: Region): ArrayMatch[] => {
  const matches: ArrayMatch[] = [];
  const count = region.beforeEnd - region.beforeStart;
  for (let offset = 0; offset < count; offset++) {
    if (
      sameValue(
        region.before[region.beforeStart + offset]!,
        region.after[region.afterStart + offset]!,
      )
    ) {
      matches.push([region.beforeStart + offset, region.afterStart + offset]);
    }
  }
  return matches;
};

const semanticMatches = (region: Region): readonly ArrayMatch[] | undefined => {
  const semantic = lcsMatches(
    region.before.slice(region.beforeStart, region.beforeEnd),
    region.after.slice(region.afterStart, region.afterEnd),
    semanticallyAligned,
    MAX_SEMANTIC_CELLS,
  );
  return semantic?.map(
    ([beforeIndex, afterIndex]) =>
      [region.beforeStart + beforeIndex, region.afterStart + afterIndex] as const,
  );
};

const matchesOf = (region: Region): readonly ArrayMatch[] | undefined => {
  const { beforeStart, beforeEnd, afterStart, afterEnd, before, after } = region;
  if (beforeEnd - beforeStart === afterEnd - afterStart) {
    const positional = positionalMatches(region);
    if (positional.length > 0) return positional;
  }
  const subsequence = identitySubsequence(
    before,
    beforeStart,
    beforeEnd,
    after,
    afterStart,
    afterEnd,
  );
  if (subsequence !== undefined && subsequence.length > 0) return subsequence;
  const identity = identityAnchors(before, beforeStart, beforeEnd, after, afterStart, afterEnd);
  if (identity.length > 0) return identity;
  const semantic = semanticMatches(region);
  return semantic !== undefined && semantic.length > 0 ? semantic : undefined;
};

const spliceRest = (region: Region): void => {
  emitOperation(region.operations, [
    "p",
    region.path,
    region.outputStart,
    region.beforeEnd - region.beforeStart,
    region.after.slice(region.afterStart, region.afterEnd),
  ]);
};

function processArrayMatches(region: Region, matches: readonly ArrayMatch[]): void {
  const { before, after, path, operations } = region;
  let beforeAt = region.beforeStart;
  let afterAt = region.afterStart;
  let outputAt = region.outputStart;
  for (const [beforeMatch, afterMatch] of matches) {
    if (overflowed(operations)) return;
    diffArrayRegion({
      ...region,
      beforeStart: beforeAt,
      beforeEnd: beforeMatch,
      afterStart: afterAt,
      afterEnd: afterMatch,
      outputStart: outputAt,
    });
    outputAt += afterMatch - afterAt;
    if (!sameValue(before[beforeMatch]!, after[afterMatch]!)) {
      diffValue(before[beforeMatch]!, after[afterMatch]!, [...path, outputAt], operations);
    }
    outputAt += 1;
    beforeAt = beforeMatch + 1;
    afterAt = afterMatch + 1;
  }
  if (overflowed(operations)) return;
  diffArrayRegion({
    ...region,
    beforeStart: beforeAt,
    afterStart: afterAt,
    outputStart: outputAt,
  });
}

function diffArrayRegion(region: Region): void {
  if (overflowed(region.operations)) return;
  trimEqualEnds(region);
  const beforeCount = region.beforeEnd - region.beforeStart;
  const afterCount = region.afterEnd - region.afterStart;
  if (beforeCount === 0 && afterCount === 0) return;
  if (beforeCount === 0 || afterCount === 0) {
    spliceRest(region);
    return;
  }
  const matches = matchesOf(region);
  if (matches !== undefined) {
    processArrayMatches(region, matches);
    return;
  }
  if (beforeCount === 1 && afterCount === 1) {
    diffValue(
      region.before[region.beforeStart]!,
      region.after[region.afterStart]!,
      [...region.path, region.outputStart],
      region.operations,
    );
    return;
  }
  spliceRest(region);
}

const diffArray = (before: JsonValue[], after: JsonValue[], path: Path, operations: Op[]): void => {
  if (before === after || equalJson(before, after)) return;
  if (
    before.length === after.length &&
    before.length > 1 &&
    !sameValue(before[0]!, after[0]!) &&
    !sameValue(before[before.length - 1]!, after[after.length - 1]!)
  ) {
    const order = permutation(before, after);
    if (order !== undefined) {
      emitOperation(operations, ["m", path, order]);
      return;
    }
  }
  diffArrayRegion({
    before,
    after,
    path,
    operations,
    beforeStart: 0,
    beforeEnd: before.length,
    afterStart: 0,
    afterEnd: after.length,
    outputStart: 0,
  });
};

const diffObject = (
  before: Record<string, JsonValue>,
  after: Record<string, JsonValue>,
  path: Path,
  operations: Op[],
): void => {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  if ([...beforeKeys, ...afterKeys].some((key) => RESERVED_SEGMENTS.has(key))) {
    if (!equalJson(before, after)) emitSet(path, after, operations);
    return;
  }
  for (const key of afterKeys) {
    if (overflowed(operations)) return;
    if (Object.hasOwn(before, key))
      diffValue(before[key]!, after[key]!, [...path, key], operations);
    else emitSet([...path, key], after[key]!, operations);
  }
  for (const key of beforeKeys) {
    if (overflowed(operations)) return;
    if (!Object.hasOwn(after, key))
      emitOperation(operations, ["d", [...path, key] as unknown as NonEmptyPath]);
  }
};

const diffValue = (before: JsonValue, after: JsonValue, path: Path, operations: Op[]): void => {
  if (before === after || overflowed(operations)) return;
  if (typeof before === "string" && typeof after === "string" && path.length > 0) {
    emitString(before, after, path as NonEmptyPath, operations);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    diffArray(before, after, path, operations);
    return;
  }
  if (
    isContainer(before) &&
    isContainer(after) &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    diffObject(before, after, path, operations);
    return;
  }
  emitSet(path, after, operations);
};

function revisionOps(before: JsonValue, after: JsonValue): Op[] {
  const operations: Op[] = [];
  diffValue(before, after, [], operations);
  if (overflowed(operations)) return [["r", after]];
  if (operations.length === 0 || operations[0]?.[0] === "r") return operations;
  let deltaCost = 2;
  for (const operation of operations) deltaCost += operationCost(operation) + 1;
  if (deltaCost < 65_536) return operations;
  const snapshotCost = jsonCost(after) + 6;
  return deltaCost >= snapshotCost ? [["r", after]] : operations;
}

export const diffRevisions: {
  (after: JsonValue): (before: JsonValue) => Op[];
  (before: JsonValue, after: JsonValue): Op[];
} = dual(2, revisionOps);
