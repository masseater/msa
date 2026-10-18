import type { JsonValue } from "../json.ts";
import type { Draft } from "./draft.ts";
import type { NonEmptyPath, Op, Path, Seg } from "./ops.ts";
import type { TrackerImpl } from "./tracker-impl.ts";

export type { JsonValue };
export { RESERVED_SEGMENTS } from "./ops.ts";
export type { NonEmptyPath, Op, Path, Seg };

type Primitive = null | boolean | number | string;
export type Container = JsonValue[] | Record<string, JsonValue>;
export type Stored = JsonValue;
export type StoredRef = Primitive | { index: number };
export type Status = "open" | "prepared" | "consumed" | "aborted" | "stale";
export type StatusCell = { value: Status };

export type InsertSource = { refs: StoredRef[] };
export type ParentKind = 0 | 1 | 2;

type BasePiece = { kind: "base"; start: number; length: number; step: 1 | -1 };
export type InsertPiece = {
  kind: "insert";
  source: InsertSource;
  start: number;
  length: number;
  step: 1 | -1;
};
export type Piece = BasePiece | InsertPiece;

export type PieceNode = {
  piece: Piece;
  left: PieceNode | undefined;
  right: PieceNode | undefined;
  priority: number;
  elements: number;
};

export type PieceLocation = {
  piece: Piece;
  logicalStart: number;
  minimum: number;
  maximum: number;
};

export type DenseRegion = { start: number; length: number };
export type DenseCandidates = { indices: number[]; bits: Uint8Array | undefined; length: number };

export type ArrayPlan = {
  removeRuns: number[];
  permutation: number[] | undefined;
  insertRuns: number[];
};

export type ArrayOverlay = {
  root: PieceNode | undefined;
  pieces: Piece[] | undefined;
  baseOverrides: Map<number, StoredRef> | undefined;
  insertOverrides: Map<InsertSource, Map<number, StoredRef>> | undefined;
  structural: boolean;
  generation: number;
  plan: ArrayPlan | undefined;
  seed: number;
  locatedOffset: number;
  baseLocations: PieceLocation[] | undefined;
  insertLocations: Map<InsertSource, PieceLocation[]> | undefined;
};

export type OverlayNode = {
  context: OverlayContext;
  baseIndex: number;
  parentIndex: number;
  parentKind: ParentKind;
  parentKey: string | number;
  parentSource?: InsertSource | undefined;
  parentPlacement: boolean;
  target: object;
  proxy: object;
  writeKey?: string | undefined;
  writeValue?: StoredRef | undefined;
  writes?: Map<string, StoredRef> | undefined;
  deleteKey?: string | undefined;
  deletes?: Set<string> | undefined;
  readded?: Set<string> | undefined;
  array?: ArrayOverlay | undefined;
  dirty?: boolean;
  subtreeDirty?: boolean | undefined;
  preparedPath?: Path | undefined;
};

export type OverlayContext = {
  owner: object;
  tracker: WeakRef<TrackerImpl<object>>;
  baseRevision: number;
  status: StatusCell;
  root: OverlayNode | undefined;
  bases: Container[] | undefined;
  stored: Container[] | undefined;
  dirty: OverlayNode[];
  nodes: OverlayNode[];
  rawNodes: WeakMap<object, OverlayNode> | undefined;
  ops: Op[] | undefined;
  replacement: boolean;
  replacementNoop: boolean;
  baseValue: object | undefined;
  overlayReleased: boolean;
  simpleObjectMaterialization: boolean;
  registryRef: WeakRef<OverlayContext> | undefined;
};

export const NODE = Symbol("chord.delta.overlay.node");
export const PREPARED = new WeakMap<object, OverlayContext>();
export const RELEASED: Record<string, JsonValue> = {};
export const ARRAY_MUTATORS = new Set<PropertyKey>([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "reverse",
  "sort",
  "fill",
  "copyWithin",
]);
export const MAX_DELTA_OPERATIONS = 4_096;
export const MAX_SIMPLE_OBJECT_NODES = 128;
export const DATA_DESCRIPTOR: PropertyDescriptor = {
  value: undefined,
  writable: true,
  enumerable: true,
  configurable: true,
};

export interface Prepared<T extends object> {
  readonly base: T;
  readonly value: T;
  readonly ops: readonly Op[];
  readonly baseRevision: number;
  abort(): void;
}

export interface Change<T extends object> {
  readonly state: Draft<T>;
  prepare(): Prepared<T>;
  abort(): void;
}

export interface Tracker<T extends object> {
  readonly value: T;
  readonly revision: number;
  beginChange(): Change<T>;
  prepareReplace(value: T): Prepared<T>;
  adopt(prepared: Prepared<T>): void;
}
