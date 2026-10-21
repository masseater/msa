import Cell from "./cell-class.ts";
import type cellDerivedTypes from "./cell-derived.types.ts";
import cellKit from "./cell-kit.ts";
import errorsModule from "./errors.ts";
import type errorsTypes from "./errors.types.ts";

const { cellDerived, cellSource } = cellKit;

const { Source } = cellSource;

const { ChordError } = errorsModule;

const isSource = (value: unknown): value is Cell<unknown> | cellDerivedTypes.Derived<unknown> =>
  value instanceof Source;

const notReady = (what: string): errorsTypes.ChordError =>
  new ChordError("not_ready", `${what} is not ready`);

const cell = {
  Cell,
  Derived: cellDerived.Derived,
  HYDRATION: cellSource.HYDRATION,
  Source: cellSource.Source,
  computeDependents: cellDerived.computeDependents,
  hydrationOf: cellSource.hydrationOf,
  isSource,
  notReady,
  sharesStructure: cellDerived.sharesStructure,
  unhydrated: cellSource.unhydrated,
};

export default cell;
