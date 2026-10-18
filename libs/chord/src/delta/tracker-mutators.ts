import { replacePieceRange } from "./tracker-array-pieces.ts";
import {
  clampIndex,
  insertPiece,
  insertPlacementPiece,
  mutatorNode,
  setArrayLength,
  toIntegerOrInfinity,
} from "./tracker-array.ts";
import { clonePlacement } from "./tracker-clone.ts";
import { arrayOverlay, markDirty } from "./tracker-object.ts";
import { arrayLength, piecesOf, replaceAllPieces } from "./tracker-pieces.ts";
import { getArrayIndex } from "./tracker-props.ts";
import { sortOverlay } from "./tracker-sort.ts";

export const arrayMutators = {
  push(this: unknown, ...items: unknown[]): number {
    const node = mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.push, this, items) as number;
    const length = arrayLength(arrayOverlay(node));
    replacePieceRange(node, length, 0, insertPlacementPiece(node, items));
    return length + items.length;
  },
  pop(this: unknown): unknown {
    const node = mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.pop, this, []);
    const length = arrayLength(arrayOverlay(node));
    if (length === 0) return undefined;
    const value = getArrayIndex(node, length - 1);
    replacePieceRange(node, length - 1, 1, []);
    return value;
  },
  shift(this: unknown): unknown {
    const node = mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.shift, this, []);
    const length = arrayLength(arrayOverlay(node));
    if (length === 0) return undefined;
    const value = getArrayIndex(node, 0);
    replacePieceRange(node, 0, 1, []);
    return value;
  },
  unshift(this: unknown, ...items: unknown[]): number {
    const node = mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.unshift, this, items) as number;
    replacePieceRange(node, 0, 0, insertPlacementPiece(node, items));
    return arrayLength(arrayOverlay(node));
  },
  splice(this: unknown, ...args: unknown[]): unknown[] {
    const node = mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.splice, this, args) as unknown[];
    const length = arrayLength(arrayOverlay(node));
    const start = args.length === 0 ? 0 : clampIndex(toIntegerOrInfinity(args[0]), length);
    const remove =
      args.length === 0
        ? 0
        : args.length === 1
          ? length - start
          : Math.min(Math.max(toIntegerOrInfinity(args[1]), 0), length - start);
    const removed = Array.from({ length: remove }, (_, offset) =>
      getArrayIndex(node, start + offset),
    );
    const itemStart = Math.min(2, args.length);
    const itemCount = Math.max(args.length - 2, 0);
    replacePieceRange(node, start, remove, insertPlacementPiece(node, args, itemStart));
    setArrayLength(node, length - remove + itemCount);
    return removed;
  },
  reverse(this: unknown): unknown {
    const node = mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.reverse, this, []);
    const overlay = arrayOverlay(node);
    if (arrayLength(overlay) < 2) return node.proxy;
    const pieces = [...piecesOf(overlay)].reverse();
    for (const piece of pieces) {
      piece.start += piece.step * (piece.length - 1);
      piece.step = piece.step === 1 ? -1 : 1;
    }
    replaceAllPieces(overlay, pieces);
    overlay.structural = true;
    overlay.generation += 1;
    overlay.plan = undefined;
    markDirty(node);
    return node.proxy;
  },
  sort(this: unknown, comparator?: unknown): unknown {
    const node = mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.sort, this, [comparator]);
    if (comparator !== undefined && typeof comparator !== "function")
      throw new TypeError("Comparator must be a function");
    return sortOverlay(node, comparator);
  },
  fill(this: unknown, supplied: unknown, startArg?: unknown, endArg?: unknown): unknown {
    const node = mutatorNode(this);
    if (node === undefined)
      return Reflect.apply(Array.prototype.fill, this, [supplied, startArg, endArg]);
    const length = arrayLength(arrayOverlay(node));
    const start = startArg === undefined ? 0 : clampIndex(toIntegerOrInfinity(startArg), length);
    const end = endArg === undefined ? length : clampIndex(toIntegerOrInfinity(endArg), length);
    if (end <= start) return node.proxy;
    const items = Array.from({ length: end - start }, () => clonePlacement(supplied));
    replacePieceRange(node, start, end - start, insertPiece(node, items));
    return node.proxy;
  },
  copyWithin(this: unknown, targetArg: unknown, startArg: unknown, endArg?: unknown): unknown {
    const node = mutatorNode(this);
    if (node === undefined)
      return Reflect.apply(Array.prototype.copyWithin, this, [targetArg, startArg, endArg]);
    const length = arrayLength(arrayOverlay(node));
    const target = clampIndex(toIntegerOrInfinity(targetArg), length);
    const start = clampIndex(toIntegerOrInfinity(startArg), length);
    const end = endArg === undefined ? length : clampIndex(toIntegerOrInfinity(endArg), length);
    const count = Math.min(Math.max(end - start, 0), length - target);
    const values = Array.from({ length: count }, (_, offset) =>
      clonePlacement(getArrayIndex(node, start + offset)),
    );
    replacePieceRange(node, target, count, insertPiece(node, values));
    return node.proxy;
  },
};
