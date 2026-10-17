import { dual } from "effect/Function";

import type { JsonValue } from "../json.ts";
import { isObj, type Op, type Path, RESERVED_SEGMENTS, type Seg } from "./ops.ts";
import { PathError } from "./path-error.ts";
import { UnsafePathError } from "./unsafe-path-error.ts";
import { assertSafePath, assertValidOp } from "./validate.ts";

const SPLICE_CHUNK = 10_000;

const write = (parent: Record<Seg, JsonValue>, key: Seg, value: JsonValue): void => {
  Object.defineProperty(parent, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

function resolveValue(root: JsonValue, path: Path): JsonValue {
  let node: JsonValue = root;
  for (const seg of path) {
    if (!isObj(node)) throw new PathError(path);
    if (Array.isArray(node) && typeof seg !== "number") throw new UnsafePathError(seg);
    if (!Object.hasOwn(node, seg as PropertyKey)) throw new PathError(path);
    node = (node as Record<Seg, JsonValue>)[seg]!;
  }
  return node;
}

function resolve(root: JsonValue, path: Path): JsonValue {
  const node = resolveValue(root, path);
  if (!isObj(node)) throw new PathError(path);
  return node;
}

function applySplice(root: JsonValue, path: Path, op: Extract<Op, { 0: "p" }>): void {
  const spliced = path.length === 0 ? root : resolve(root, path);
  if (!Array.isArray(spliced)) throw new PathError(path);
  spliced.splice(op[2], op[3]);
  for (let offset = 0; offset < op[4].length; offset += SPLICE_CHUNK) {
    spliced.splice(op[2] + offset, 0, ...op[4].slice(offset, offset + SPLICE_CHUNK));
  }
}

function applyMove(root: JsonValue, path: Path, order: readonly number[]): void {
  const moved = path.length === 0 ? root : resolve(root, path);
  if (!Array.isArray(moved) || moved.length !== order.length) throw new PathError(path);
  const previous = moved.slice();
  for (let index = 0; index < order.length; index++) moved[index] = previous[order[index]!]!;
}

function applyLeaf(
  root: JsonValue,
  path: Path,
  op: Extract<Op, { 0: "s" | "d" | "a" | "t" }>,
): void {
  const parent = resolve(root, path.slice(0, -1)) as Record<Seg, JsonValue>;
  const key = path[path.length - 1]!;
  if (Array.isArray(parent)) {
    if (typeof key !== "number") throw new UnsafePathError(key);
    if (key > parent.length) throw new UnsafePathError(key);
  }
  const current = Object.hasOwn(parent, key) ? parent[key] : undefined;
  switch (op[0]) {
    case "s":
      write(parent, key, op[2]);
      return;
    case "d":
      if (Array.isArray(parent)) {
        if (typeof key !== "number" || key >= parent.length) throw new PathError(path);
        (parent as unknown as JsonValue[]).splice(key, 1);
      } else delete parent[key];
      return;
    case "a":
      if (typeof current !== "string") throw new PathError(path);
      write(parent, key, `${current}${op[2]}`);
      return;
    case "t":
      if (typeof current !== "string") throw new PathError(path);
      write(parent, key, current.slice(op[2]));
  }
}

function applyOps<T>(target: T | undefined, ops: readonly Op[]): T {
  let root = target as unknown as JsonValue;
  for (const op of ops) {
    assertValidOp(op);
    if (op[0] === "r") {
      root = op[1];
      continue;
    }
    const path = op[1];
    assertSafePath(path);
    if (op[0] === "p") applySplice(root, path, op);
    else if (op[0] === "m") applyMove(root, path, op[2]);
    else applyLeaf(root, path, op);
  }
  return root as unknown as T;
}

function appendCopy(
  root: JsonValue,
  op: Extract<Op, { 0: "p" }>,
  owned: WeakSet<object>,
): JsonValue | undefined {
  const [, path, index, deleteCount, items] = op;
  if (deleteCount !== 0) return undefined;
  let target: JsonValue = root;
  for (const segment of path) {
    const valid =
      typeof segment === "string"
        ? !RESERVED_SEGMENTS.has(segment) && isObj(target) && !Array.isArray(target)
        : Number.isInteger(segment) && segment >= 0 && Array.isArray(target);
    if (!valid || !Object.hasOwn(target as object, segment)) return undefined;
    target = (target as Record<Seg, JsonValue>)[segment]!;
  }
  if (!Array.isArray(target) || owned.has(target) || index !== target.length) return undefined;
  const appended = target.concat(items);
  owned.add(appended);
  if (path.length === 0) return appended;
  const parentPath = path.slice(0, -1);
  const copiedRoot = copyContainers(root, parentPath, owned);
  write(
    resolve(copiedRoot, parentPath) as Record<Seg, JsonValue>,
    path[path.length - 1]!,
    appended,
  );
  return copiedRoot;
}

function copyNode(value: JsonValue, path: Path): JsonValue[] | Record<string, JsonValue> {
  if (Array.isArray(value)) return value.slice();
  if (!isObj(value)) throw new PathError(path);
  const result = Object.create(
    Object.getPrototypeOf(value) === null ? null : Object.prototype,
  ) as Record<string, JsonValue>;
  for (const key of Object.keys(value)) {
    write(result, key, (value as Record<string, JsonValue>)[key]!);
  }
  return result;
}

function copyContainers(root: JsonValue, path: Path, owned: WeakSet<object>): JsonValue {
  if (!isObj(root)) throw new PathError(path);
  let copiedRoot: JsonValue[] | Record<string, JsonValue>;
  if (owned.has(root)) copiedRoot = root as JsonValue[] | Record<string, JsonValue>;
  else {
    copiedRoot = copyNode(root, path);
    owned.add(copiedRoot);
  }
  let destination = copiedRoot;
  for (const segment of path) {
    if (!Object.hasOwn(destination, segment)) throw new PathError(path);
    if (Array.isArray(destination) && typeof segment !== "number")
      throw new UnsafePathError(segment);
    const child = (destination as Record<Seg, JsonValue>)[segment]!;
    if (!isObj(child)) throw new PathError(path);
    if (owned.has(child)) {
      destination = child as JsonValue[] | Record<string, JsonValue>;
      continue;
    }
    const copiedChild = copyNode(child, path);
    write(destination as Record<Seg, JsonValue>, segment, copiedChild);
    owned.add(copiedChild);
    destination = copiedChild;
  }
  return copiedRoot;
}

function appliedImmutableBatches<T>(target: T | undefined, batches: Iterable<readonly Op[]>): T {
  let root = target as unknown as JsonValue;
  const owned = new WeakSet<object>();
  for (const ops of batches) {
    for (const op of ops) {
      assertValidOp(op);
      if (op[0] === "r") {
        root = op[1];
        continue;
      }
      if (op[0] === "p") {
        const appended = appendCopy(root, op, owned);
        if (appended !== undefined) {
          root = appended;
          continue;
        }
      }
      root = copyContainers(
        root,
        op[0] === "p" || op[0] === "m" ? op[1] : op[1].slice(0, -1),
        owned,
      );
      root = applyOps(root, [op]);
    }
  }
  return root as unknown as T;
}

export const apply: {
  (ops: readonly Op[]): <T>(target: T | undefined) => T;
  <T>(target: T | undefined, ops: readonly Op[]): T;
} = dual(2, applyOps);

export const applyImmutable: {
  (ops: readonly Op[]): <T>(target: T | undefined) => T;
  <T>(target: T | undefined, ops: readonly Op[]): T;
} = dual(2, <T>(target: T | undefined, ops: readonly Op[]): T =>
  appliedImmutableBatches(target, [ops]),
);

export const applyImmutableBatches: {
  (batches: Iterable<readonly Op[]>): <T>(target: T | undefined) => T;
  <T>(target: T | undefined, batches: Iterable<readonly Op[]>): T;
} = dual(2, appliedImmutableBatches);
