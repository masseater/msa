import { dual } from "effect/Function";

import type jsonTypes from "../json.types.ts";
import opsModule from "./ops.ts";
import type opsTypes from "./ops.types.ts";
import PathError from "./path-error.ts";
import UnsafePathError from "./unsafe-path-error.ts";
import validate from "./validate.ts";

const { RESERVED_SEGMENTS, isObj } = opsModule;

const { assertSafePath } = validate;
const assertValidOp: typeof validate.assertValidOp = validate.assertValidOp;

const SPLICE_CHUNK = 10_000;

const write = (
  parent: Record<opsTypes.Seg, jsonTypes.JsonValue>,
  key: opsTypes.Seg,
  value: jsonTypes.JsonValue,
): void => {
  Object.defineProperty(parent, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
};

function resolveValue(root: jsonTypes.JsonValue, path: opsTypes.Path): jsonTypes.JsonValue {
  let node: jsonTypes.JsonValue = root;
  for (const seg of path) {
    if (!isObj(node)) throw PathError.create(path);
    if (Array.isArray(node) && typeof seg !== "number") throw UnsafePathError.create(seg);
    if (!Object.hasOwn(node, seg as PropertyKey)) throw PathError.create(path);
    node = (node as Record<opsTypes.Seg, jsonTypes.JsonValue>)[seg]!;
  }
  return node;
}

function resolve(root: jsonTypes.JsonValue, path: opsTypes.Path): jsonTypes.JsonValue {
  const node = resolveValue(root, path);
  if (!isObj(node)) throw PathError.create(path);
  return node;
}

function applySplice(
  root: jsonTypes.JsonValue,
  path: opsTypes.Path,
  op: Extract<opsTypes.Op, { 0: "p" }>,
): void {
  const spliced = path.length === 0 ? root : resolve(root, path);
  if (!Array.isArray(spliced)) throw PathError.create(path);
  spliced.splice(op[2], op[3]);
  for (let offset = 0; offset < op[4].length; offset += SPLICE_CHUNK) {
    spliced.splice(op[2] + offset, 0, ...op[4].slice(offset, offset + SPLICE_CHUNK));
  }
}

function applyMove(root: jsonTypes.JsonValue, path: opsTypes.Path, order: readonly number[]): void {
  const moved = path.length === 0 ? root : resolve(root, path);
  if (!Array.isArray(moved) || moved.length !== order.length) throw PathError.create(path);
  const previous = moved.slice();
  for (let index = 0; index < order.length; index++) moved[index] = previous[order[index]!]!;
}

function applyLeaf(
  root: jsonTypes.JsonValue,
  path: opsTypes.Path,
  op: Extract<opsTypes.Op, { 0: "s" | "d" | "a" | "t" }>,
): void {
  const parent = resolve(root, path.slice(0, -1)) as Record<opsTypes.Seg, jsonTypes.JsonValue>;
  const key = path[path.length - 1]!;
  if (Array.isArray(parent)) {
    if (typeof key !== "number") throw UnsafePathError.create(key);
    if (key > parent.length) throw UnsafePathError.create(key);
  }
  const current = Object.hasOwn(parent, key) ? parent[key] : undefined;
  switch (op[0]) {
    case "s":
      write(parent, key, op[2]);
      return;
    case "d":
      if (Array.isArray(parent)) {
        if (typeof key !== "number" || key >= parent.length) throw PathError.create(path);
        (parent as unknown as jsonTypes.JsonValue[]).splice(key, 1);
      } else delete parent[key];
      return;
    case "a":
      if (typeof current !== "string") throw PathError.create(path);
      write(parent, key, `${current}${op[2]}`);
      return;
    case "t":
      if (typeof current !== "string") throw PathError.create(path);
      write(parent, key, current.slice(op[2]));
  }
}

function applyOps<T>(target: T | undefined, ops: readonly opsTypes.Op[]): T {
  let root = target as unknown as jsonTypes.JsonValue;
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
  root: jsonTypes.JsonValue,
  op: Extract<opsTypes.Op, { 0: "p" }>,
  owned: WeakSet<object>,
): jsonTypes.JsonValue | undefined {
  const [, path, index, deleteCount, items] = op;
  if (deleteCount !== 0) return undefined;
  let target: jsonTypes.JsonValue = root;
  for (const segment of path) {
    const valid =
      typeof segment === "string"
        ? !RESERVED_SEGMENTS.has(segment) && isObj(target) && !Array.isArray(target)
        : Number.isInteger(segment) && segment >= 0 && Array.isArray(target);
    if (!valid || !Object.hasOwn(target as object, segment)) return undefined;
    target = (target as Record<opsTypes.Seg, jsonTypes.JsonValue>)[segment]!;
  }
  if (!Array.isArray(target) || owned.has(target) || index !== target.length) return undefined;
  const appended = target.concat(items);
  owned.add(appended);
  if (path.length === 0) return appended;
  const parentPath = path.slice(0, -1);
  const copiedRoot = copyContainers(root, parentPath, owned);
  write(
    resolve(copiedRoot, parentPath) as Record<opsTypes.Seg, jsonTypes.JsonValue>,
    path[path.length - 1]!,
    appended,
  );
  return copiedRoot;
}

function copyNode(
  value: jsonTypes.JsonValue,
  path: opsTypes.Path,
): jsonTypes.JsonValue[] | Record<string, jsonTypes.JsonValue> {
  if (Array.isArray(value)) return value.slice();
  if (!isObj(value)) throw PathError.create(path);
  const result = Object.create(
    Object.getPrototypeOf(value) === null ? null : Object.prototype,
  ) as Record<string, jsonTypes.JsonValue>;
  for (const key of Object.keys(value)) {
    write(result, key, (value as Record<string, jsonTypes.JsonValue>)[key]!);
  }
  return result;
}

function copyContainers(
  root: jsonTypes.JsonValue,
  path: opsTypes.Path,
  owned: WeakSet<object>,
): jsonTypes.JsonValue {
  if (!isObj(root)) throw PathError.create(path);
  let copiedRoot: jsonTypes.JsonValue[] | Record<string, jsonTypes.JsonValue>;
  if (owned.has(root))
    copiedRoot = root as jsonTypes.JsonValue[] | Record<string, jsonTypes.JsonValue>;
  else {
    copiedRoot = copyNode(root, path);
    owned.add(copiedRoot);
  }
  let destination = copiedRoot;
  for (const segment of path) {
    if (!Object.hasOwn(destination, segment)) throw PathError.create(path);
    if (Array.isArray(destination) && typeof segment !== "number")
      throw UnsafePathError.create(segment);
    const child = (destination as Record<opsTypes.Seg, jsonTypes.JsonValue>)[segment]!;
    if (!isObj(child)) throw PathError.create(path);
    if (owned.has(child)) {
      destination = child as jsonTypes.JsonValue[] | Record<string, jsonTypes.JsonValue>;
      continue;
    }
    const copiedChild = copyNode(child, path);
    write(destination as Record<opsTypes.Seg, jsonTypes.JsonValue>, segment, copiedChild);
    owned.add(copiedChild);
    destination = copiedChild;
  }
  return copiedRoot;
}

function appliedImmutableBatches<T>(
  target: T | undefined,
  batches: Iterable<readonly opsTypes.Op[]>,
): T {
  let root = target as unknown as jsonTypes.JsonValue;
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

const apply: {
  (ops: readonly opsTypes.Op[]): <T>(target: T | undefined) => T;
  <T>(target: T | undefined, ops: readonly opsTypes.Op[]): T;
} = dual(2, applyOps);

const applyImmutable: {
  (ops: readonly opsTypes.Op[]): <T>(target: T | undefined) => T;
  <T>(target: T | undefined, ops: readonly opsTypes.Op[]): T;
} = dual(2, <T>(target: T | undefined, ops: readonly opsTypes.Op[]): T =>
  appliedImmutableBatches(target, [ops]),
);

const applyImmutableBatches: {
  (batches: Iterable<readonly opsTypes.Op[]>): <T>(target: T | undefined) => T;
  <T>(target: T | undefined, batches: Iterable<readonly opsTypes.Op[]>): T;
} = dual(2, appliedImmutableBatches);

const applyModule = {
  apply,
  applyImmutable,
  applyImmutableBatches,
};

export default applyModule;
