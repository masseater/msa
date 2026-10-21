import text from "../../utils/text.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";
import settingsLoading from "./settings-loading.ts";

const { stripBom } = text;

type Field = keyof settingsSchemaTypes.Settings;

const parseCurrent = (current: string | undefined): settingsSchemaTypes.Settings =>
  current !== undefined && current !== ""
    ? settingsLoading.migrateSettings(JSON.parse(stripBom(current)) as Record<string, unknown>)
    : {};

const mergeNested = (
  base: unknown,
  inMemory: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> => {
  const merged = { ...((base as Record<string, unknown> | undefined) ?? {}) };
  for (const key of keys) merged[key] = inMemory[key];
  return merged;
};

function mergeModifiedSettings(options: {
  readonly current: string | undefined;
  readonly snapshot: settingsSchemaTypes.Settings;
  readonly fields: ReadonlySet<Field>;
  readonly nestedFields: ReadonlyMap<Field, ReadonlySet<string>>;
}): string {
  const currentFileSettings = parseCurrent(options.current);
  const merged: Record<string, unknown> = { ...currentFileSettings };
  for (const field of options.fields) {
    const value = options.snapshot[field];
    const nested = options.nestedFields.get(field);
    merged[field] =
      nested !== undefined && typeof value === "object" && value !== null
        ? mergeNested(currentFileSettings[field], value as Record<string, unknown>, nested)
        : value;
  }
  return JSON.stringify(merged, null, 2);
}

const modifiedMerge = { mergeModifiedSettings };

export default modifiedMerge;
