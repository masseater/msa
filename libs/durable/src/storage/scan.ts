import { Function } from "effect";

import errors from "../errors.ts";
import type typesModule from "../types.types.ts";
import type scanTypes from "./scan.types.ts";

const { StorageRequestError } = errors;

type StoredCursor = Readonly<Record<string, unknown>> | undefined;

const isScanOrder = (value: unknown): value is typesModule.ScanOrder =>
  value === "ascending" || value === "descending";

const scanStart: {
  (
    cursor: StoredCursor,
    fallback: typesModule.ScanOrder,
  ): (requested: typesModule.ScanOrder | undefined) => scanTypes.ScanStart;
  (
    requested: typesModule.ScanOrder | undefined,
    cursor: StoredCursor,
    fallback: typesModule.ScanOrder,
  ): scanTypes.ScanStart;
} = Function.dual(
  3,
  (
    requested: typesModule.ScanOrder | undefined,
    cursor: StoredCursor,
    fallback: typesModule.ScanOrder,
  ): scanTypes.ScanStart => {
    if (requested !== undefined && !isScanOrder(requested)) {
      throw new StorageRequestError(`Invalid scan order: ${String(requested)}`);
    }
    if (cursor === undefined) return { after: undefined, order: requested ?? fallback };
    const { after, order: stored } = cursor;
    if (typeof after !== "number" || !Number.isSafeInteger(after))
      throw new StorageRequestError("Invalid storage cursor");
    if (stored !== undefined && !isScanOrder(stored)) {
      throw new StorageRequestError("Invalid storage cursor");
    }
    const order = stored ?? fallback;
    if (requested !== undefined && requested !== order) {
      throw new StorageRequestError(
        `The cursor continues a ${order} scan; the query asks for ${requested}`,
      );
    }
    return { after, order };
  },
);

const nextCursor: {
  (order: typesModule.ScanOrder): (id: typesModule.Id<string>) => {
    readonly after: number;
    readonly order: typesModule.ScanOrder;
  };
  (
    id: typesModule.Id<string>,
    order: typesModule.ScanOrder,
  ): { readonly after: number; readonly order: typesModule.ScanOrder };
} = Function.dual(
  2,
  (
    id: typesModule.Id<string>,
    order: typesModule.ScanOrder,
  ): { readonly after: number; readonly order: typesModule.ScanOrder } => ({
    after: id,
    order,
  }),
);

const scan = {
  nextCursor,
  scanStart,
};

export default scan;
