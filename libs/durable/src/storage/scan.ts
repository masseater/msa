import { Function } from "effect";

import { StorageRequestError } from "../errors.ts";
import type { Id, ScanOrder } from "../types.ts";

export type ScanStart = {
  readonly order: ScanOrder;
  readonly after: number | undefined;
};

type StoredCursor = Readonly<Record<string, unknown>> | undefined;

const isScanOrder = (value: unknown): value is ScanOrder =>
  value === "ascending" || value === "descending";

export const scanStart: {
  (cursor: StoredCursor, fallback: ScanOrder): (requested: ScanOrder | undefined) => ScanStart;
  (requested: ScanOrder | undefined, cursor: StoredCursor, fallback: ScanOrder): ScanStart;
} = Function.dual(
  3,
  (requested: ScanOrder | undefined, cursor: StoredCursor, fallback: ScanOrder): ScanStart => {
    if (requested !== undefined && !isScanOrder(requested)) {
      throw new StorageRequestError(`Invalid scan order: ${String(requested)}`);
    }
    if (cursor === undefined) return { order: requested ?? fallback, after: undefined };
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
    return { order, after };
  },
);

export const nextCursor: {
  (order: ScanOrder): (id: Id<string>) => { readonly after: number; readonly order: ScanOrder };
  (id: Id<string>, order: ScanOrder): { readonly after: number; readonly order: ScanOrder };
} = Function.dual(
  2,
  (id: Id<string>, order: ScanOrder): { readonly after: number; readonly order: ScanOrder } => ({
    after: id,
    order,
  }),
);
