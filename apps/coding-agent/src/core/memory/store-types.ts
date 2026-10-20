import type storeTypesTypes from "./store-types.types.ts";

const MEMORY_KINDS: readonly storeTypesTypes.MemoryKind[] = [
  "fact",
  "preference",
  "decision",
  "note",
];

const RRF_K = 60;

const storeTypes = {
  MEMORY_KINDS,
  RRF_K,
};

export default storeTypes;
