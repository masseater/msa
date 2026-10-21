import type jsonTypes from "../json.types.ts";
import type draftTypes from "./draft.ts";
import type opsTypes from "./ops.types.ts";
import type trackerImplTypes from "./tracker-impl.types.ts";

declare namespace trackerTypesModule {
  type Primitive = null | boolean | number | string;

  type Container = jsonTypes.JsonValue[] | Record<string, jsonTypes.JsonValue>;

  type Stored = jsonTypes.JsonValue;

  type StoredRef = Primitive | { index: number };

  type Status = "open" | "prepared" | "consumed" | "aborted" | "stale";

  type StatusCell = { value: Status };

  type InsertSource = { refs: StoredRef[] };

  type ParentKind = 0 | 1 | 2;

  type BasePiece = { kind: "base"; start: number; length: number; step: 1 | -1 };

  type InsertPiece = {
    kind: "insert";
    source: InsertSource;
    start: number;
    length: number;
    step: 1 | -1;
  };

  type Piece = BasePiece | InsertPiece;

  type PieceNode = {
    piece: Piece;
    left: PieceNode | undefined;
    right: PieceNode | undefined;
    priority: number;
    elements: number;
  };

  type PieceLocation = {
    piece: Piece;
    logicalStart: number;
    minimum: number;
    maximum: number;
  };

  type DenseRegion = { start: number; length: number };

  type DenseCandidates = { indices: number[]; bits: Uint8Array | undefined; length: number };

  type ArrayPlan = {
    removeRuns: number[];
    permutation: number[] | undefined;
    insertRuns: number[];
  };

  type ArrayOverlay = {
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

  type OverlayNode = {
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
    preparedPath?: opsTypes.Path | undefined;
  };

  type OverlayContext = {
    owner: object;
    tracker: WeakRef<trackerImplTypes.TrackerImpl<object>>;
    baseRevision: number;
    status: StatusCell;
    root: OverlayNode | undefined;
    bases: Container[] | undefined;
    stored: Container[] | undefined;
    dirty: OverlayNode[];
    nodes: OverlayNode[];
    rawNodes: WeakMap<object, OverlayNode> | undefined;
    ops: opsTypes.Op[] | undefined;
    replacement: boolean;
    replacementNoop: boolean;
    baseValue: object | undefined;
    overlayReleased: boolean;
    simpleObjectMaterialization: boolean;
    registryRef: WeakRef<OverlayContext> | undefined;
  };

  interface Prepared<T extends object> {
    readonly base: T;
    readonly value: T;
    readonly ops: readonly opsTypes.Op[];
    readonly baseRevision: number;
    abort(): void;
  }

  interface Change<T extends object> {
    readonly state: draftTypes.Draft<T>;
    prepare(): Prepared<T>;
    abort(): void;
  }

  interface Tracker<T extends object> {
    readonly value: T;
    readonly revision: number;
    beginChange(): Change<T>;
    prepareReplace(value: T): Prepared<T>;
    adopt(prepared: Prepared<T>): void;
  }

  type JsonValue = jsonTypes.JsonValue;

  type NonEmptyPath = opsTypes.NonEmptyPath;

  type Op = opsTypes.Op;

  type Path = opsTypes.Path;

  type Seg = opsTypes.Seg;
}

export type { trackerTypesModule as default };
