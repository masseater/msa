import trackerArrayPieces from "./tracker-array-pieces.ts";
import trackerArray from "./tracker-array.ts";
import trackerClone from "./tracker-clone.ts";
import trackerObject from "./tracker-object.ts";
import trackerPieces from "./tracker-pieces.ts";
import trackerProps from "./tracker-props.ts";
import trackerSort from "./tracker-sort.ts";
const arrayMutators = {
  copyWithin(this: unknown, targetArg: unknown, startArg: unknown, endArg?: unknown): unknown {
    const node = trackerArray.mutatorNode(this);
    if (node === undefined)
      return Reflect.apply(Array.prototype.copyWithin, this, [targetArg, startArg, endArg]);
    const length = trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
    const target = trackerArray.clampIndex(trackerArray.toIntegerOrInfinity(targetArg), length);
    const start = trackerArray.clampIndex(trackerArray.toIntegerOrInfinity(startArg), length);
    const end =
      endArg === undefined
        ? length
        : trackerArray.clampIndex(trackerArray.toIntegerOrInfinity(endArg), length);
    const count = Math.min(Math.max(end - start, 0), length - target);
    const values = Array.from({ length: count }, (_, offset) =>
      trackerClone.clonePlacement(trackerProps.getArrayIndex(node, start + offset)),
    );
    trackerArrayPieces.replacePieceRange(
      node,
      target,
      count,
      trackerArray.insertPiece(node, values),
    );
    return node.proxy;
  },
  fill(this: unknown, supplied: unknown, startArg?: unknown, endArg?: unknown): unknown {
    const node = trackerArray.mutatorNode(this);
    if (node === undefined)
      return Reflect.apply(Array.prototype.fill, this, [supplied, startArg, endArg]);
    const length = trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
    const start =
      startArg === undefined
        ? 0
        : trackerArray.clampIndex(trackerArray.toIntegerOrInfinity(startArg), length);
    const end =
      endArg === undefined
        ? length
        : trackerArray.clampIndex(trackerArray.toIntegerOrInfinity(endArg), length);
    if (end <= start) return node.proxy;
    const items = Array.from({ length: end - start }, () => trackerClone.clonePlacement(supplied));
    trackerArrayPieces.replacePieceRange(
      node,
      start,
      end - start,
      trackerArray.insertPiece(node, items),
    );
    return node.proxy;
  },
  pop(this: unknown): unknown {
    const node = trackerArray.mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.pop, this, []);
    const length = trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
    if (length === 0) return undefined;
    const value = trackerProps.getArrayIndex(node, length - 1);
    trackerArrayPieces.replacePieceRange(node, length - 1, 1, []);
    return value;
  },
  push(this: unknown, ...items: unknown[]): number {
    const node = trackerArray.mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.push, this, items) as number;
    const length = trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
    trackerArrayPieces.replacePieceRange(
      node,
      length,
      0,
      trackerArray.insertPlacementPiece(node, items),
    );
    return length + items.length;
  },
  reverse(this: unknown): unknown {
    const node = trackerArray.mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.reverse, this, []);
    const overlay = trackerObject.arrayOverlay(node);
    if (trackerPieces.arrayLength(overlay) < 2) return node.proxy;
    const pieces = [...trackerPieces.piecesOf(overlay)].reverse();
    for (const piece of pieces) {
      piece.start += piece.step * (piece.length - 1);
      piece.step = piece.step === 1 ? -1 : 1;
    }
    trackerPieces.replaceAllPieces(overlay, pieces);
    overlay.structural = true;
    overlay.generation += 1;
    overlay.plan = undefined;
    trackerObject.markDirty(node);
    return node.proxy;
  },
  shift(this: unknown): unknown {
    const node = trackerArray.mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.shift, this, []);
    const length = trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
    if (length === 0) return undefined;
    const value = trackerProps.getArrayIndex(node, 0);
    trackerArrayPieces.replacePieceRange(node, 0, 1, []);
    return value;
  },
  sort(this: unknown, comparator?: unknown): unknown {
    const node = trackerArray.mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.sort, this, [comparator]);
    if (comparator !== undefined && typeof comparator !== "function")
      throw new TypeError("Comparator must be a function");
    return trackerSort.sortOverlay(node, comparator);
  },
  splice(this: unknown, ...args: unknown[]): unknown[] {
    const node = trackerArray.mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.splice, this, args) as unknown[];
    const length = trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
    const start =
      args.length === 0
        ? 0
        : trackerArray.clampIndex(trackerArray.toIntegerOrInfinity(args[0]), length);
    const remove =
      args.length === 0
        ? 0
        : args.length === 1
          ? length - start
          : Math.min(Math.max(trackerArray.toIntegerOrInfinity(args[1]), 0), length - start);
    const removed = Array.from({ length: remove }, (_, offset) =>
      trackerProps.getArrayIndex(node, start + offset),
    );
    const itemStart = Math.min(2, args.length);
    const itemCount = Math.max(args.length - 2, 0);
    trackerArrayPieces.replacePieceRange(
      node,
      start,
      remove,
      trackerArray.insertPlacementPiece(node, args, itemStart),
    );
    trackerArray.setArrayLength(node, length - remove + itemCount);
    return removed;
  },
  unshift(this: unknown, ...items: unknown[]): number {
    const node = trackerArray.mutatorNode(this);
    if (node === undefined) return Reflect.apply(Array.prototype.unshift, this, items) as number;
    trackerArrayPieces.replacePieceRange(
      node,
      0,
      0,
      trackerArray.insertPlacementPiece(node, items),
    );
    return trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
  },
};

const trackerMutators = {
  arrayMutators,
};

export default trackerMutators;
