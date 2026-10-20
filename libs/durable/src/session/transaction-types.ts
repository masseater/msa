import type deltaTypes from "@msa/chord/delta.types";
import json from "@msa/chord/json";

const { copyJson } = json;

const INTERNAL_SCAN_PAGE_SIZE = 256;
const EMPTY_OPERATIONS: readonly deltaTypes.Op[] = [];
const TABLE_JSON_COPY_OPTIONS = { omitUndefinedProperties: true } as const;

const copyTableJson = <T>(value: unknown): T => copyJson(value, TABLE_JSON_COPY_OPTIONS) as T;

const transactionTypes = {
  EMPTY_OPERATIONS,
  INTERNAL_SCAN_PAGE_SIZE,
  TABLE_JSON_COPY_OPTIONS,
  copyTableJson,
};

export default transactionTypes;
