import { Function } from "effect";

import errors from "../../errors.ts";
import ids from "../../ids.ts";
import type typesModule from "../../types.types.ts";
import scan from "../scan.ts";
import type scanTypes from "../scan.types.ts";

const { StorageRequestError } = errors;
const { idFromNumber } = ids;
const { nextCursor } = scan;

type ScopeColumns = {
  readonly scopeKind: typesModule.DocumentRecord["scope"]["kind"];
  readonly ownerId: number;
};

const parseJson = <T>(value: string): T => JSON.parse(value) as T;
const encodeJson = (value: unknown): string => JSON.stringify(value) as string;
const encodeIndexedString = (value: string): string => JSON.stringify(value);

const cursorId = <I extends typesModule.Id<string>>(
  cursor: typesModule.Cursor | undefined,
): I | undefined => {
  const after = cursor?.["after"];
  if (after === undefined) return undefined;
  if (typeof after !== "number" || !Number.isSafeInteger(after))
    throw new StorageRequestError("Invalid storage cursor");
  return idFromNumber<I>(after);
};

const page: {
  (
    limit: number,
    order?: typesModule.ScanOrder,
  ): <T extends { readonly id: typesModule.Id<string> }>(
    values: readonly T[],
  ) => typesModule.Page<T, typesModule.Cursor>;
  <T extends { readonly id: typesModule.Id<string> }>(
    values: readonly T[],
    limit: number,
    order?: typesModule.ScanOrder,
  ): typesModule.Page<T, typesModule.Cursor>;
} = Function.dual(
  (args: IArguments) => Array.isArray(args[0]),
  <T extends { readonly id: typesModule.Id<string> }>(
    values: readonly T[],
    limit: number,
    order: typesModule.ScanOrder = "ascending",
  ): typesModule.Page<T, typesModule.Cursor> => {
    const items = values.slice(0, limit);
    if (values.length <= limit) return { items };
    return { items, next: nextCursor(items.at(-1)!.id, order) };
  },
);

const scanSql = (
  start: scanTypes.ScanStart,
): { readonly clause: string; readonly param: number; readonly direction: string } =>
  start.order === "ascending"
    ? { clause: "id > ?", direction: "ASC", param: start.after ?? -1 }
    : { clause: "id < ?", direction: "DESC", param: start.after ?? Number.MAX_SAFE_INTEGER };

const scopeColumns = (scope: typesModule.DocumentRecord["scope"]): ScopeColumns => {
  switch (scope.kind) {
    case "session":
      return { ownerId: 0, scopeKind: "session" };
    case "conversation":
      return { ownerId: scope.conversationId, scopeKind: "conversation" };
    case "task":
      return { ownerId: scope.taskId, scopeKind: "task" };
  }
};

const addressParts = (
  address: typesModule.DocumentAddress | typesModule.DocumentCreate | typesModule.DocumentRecord,
) => {
  const scope = scopeColumns(address.scope);
  return {
    kind: encodeIndexedString(address.kind),
    ...scope,
    family: address.key === undefined ? 0 : 1,
    keyValue: encodeIndexedString(address.key ?? ""),
  };
};

const addressKey = (
  address: typesModule.DocumentAddress | typesModule.DocumentCreate | typesModule.DocumentRecord,
): string => {
  const parts = addressParts(address);
  return JSON.stringify([parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue]);
};

const isAliveAt: {
  (at: typesModule.DocumentPoint): (record: typesModule.DocumentRecord) => boolean;
  (record: typesModule.DocumentRecord, at: typesModule.DocumentPoint): boolean;
} = Function.dual(
  2,
  (record: typesModule.DocumentRecord, at: typesModule.DocumentPoint): boolean => {
    if (at === "current") return record.retiredAt === undefined;
    return record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
  },
);

const isCurrentOnly = (record: typesModule.DocumentRecord): boolean =>
  record.scope.kind !== "conversation" || record.history === "latest";

const writeId = (write: typesModule.StorageWrite): typesModule.Id<string> | undefined => {
  switch (write.type) {
    case "conversation":
    case "entry":
    case "task":
    case "submission":
      return write.value.id;
    case "document.create":
    case "document.copy":
      return write.record.id;
    case "document.change":
    case "document.retire":
      return undefined;
  }
};

const codec = {
  addressKey,
  addressParts,
  cursorId,
  encodeIndexedString,
  encodeJson,
  isAliveAt,
  isCurrentOnly,
  page,
  parseJson,
  scanSql,
  scopeColumns,
  writeId,
};

export default codec;
