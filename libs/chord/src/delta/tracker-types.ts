import type jsonTypes from "../json.types.ts";
import opsModule from "./ops.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

const NODE = Symbol("chord.delta.overlay.node");
const PREPARED = new WeakMap<object, trackerTypesModule.OverlayContext>();
const RELEASED: Record<string, jsonTypes.JsonValue> = {};
const ARRAY_MUTATORS = new Set<PropertyKey>([
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
const MAX_DELTA_OPERATIONS = 4_096;
const MAX_SIMPLE_OBJECT_NODES = 128;
const DATA_DESCRIPTOR: PropertyDescriptor = {
  configurable: true,
  enumerable: true,
  value: undefined,
  writable: true,
};

const trackerTypes = {
  ARRAY_MUTATORS,
  DATA_DESCRIPTOR,
  MAX_DELTA_OPERATIONS,
  MAX_SIMPLE_OBJECT_NODES,
  NODE,
  PREPARED,
  RELEASED,
  RESERVED_SEGMENTS: opsModule.RESERVED_SEGMENTS,
};

export default trackerTypes;
