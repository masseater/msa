import type cellSourceTypes from "./cell-source.types.ts";
import Source from "./source.ts";

const HYDRATION: unique symbol = Symbol("chord.hydration");

function hydrationOf(value: unknown): cellSourceTypes.Hydration | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return (value as { readonly [HYDRATION]?: cellSourceTypes.Hydration })[HYDRATION];
}

const unhydrated = (sources: Iterable<unknown>): cellSourceTypes.Hydration[] =>
  [...sources]
    .map(hydrationOf)
    .filter((hydration): hydration is cellSourceTypes.Hydration => hydration?.hydrated === false);

const cellSource = {
  HYDRATION,
  Source,
  hydrationOf,
  unhydrated,
};

export default cellSource;
