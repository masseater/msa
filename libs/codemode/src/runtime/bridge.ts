import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import { dual } from "effect/Function";

import type { CodemodeError, CodemodeStoreWrites } from "../types.ts";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BridgeError extends Data.TaggedError("BridgeError")<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}

export function causeMessage(cause: Cause.Cause<unknown>): string {
  return errorMessage(cause.pipe(Cause.squash));
}

export function serializeStore(
  store: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> {
  const serialized: Record<string, string> = {};
  for (const [key, value] of Object.entries(store ?? {})) {
    const json = JSON.stringify(value);
    if (json !== undefined) serialized[key] = json;
  }
  return serialized;
}

export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export function stringifyJson(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

export const parseBridgeJson: {
  (what: string): (json: string) => unknown;
  (json: string, what: string): unknown;
} = dual(2, (json: string, what: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    throw new BridgeError(`${what} is not valid JSON`);
  }
});

const isWriteEntry = (entry: unknown): entry is [string, string?] =>
  Array.isArray(entry) &&
  typeof entry[0] === "string" &&
  (entry.length === 2 ? typeof entry[1] === "string" : entry.length === 1);

export function parseStoreWrites(json: string): CodemodeStoreWrites {
  const entries = parseBridgeJson(json, "store writes");
  if (!Array.isArray(entries)) throw new BridgeError("store writes are not an array");
  const writes: CodemodeStoreWrites = { set: {}, delete: [] };
  for (const entry of entries) {
    if (!isWriteEntry(entry)) throw new BridgeError("store writes contain a malformed entry");
    const [key, value] = entry;
    if (value === undefined) writes.delete.push(key);
    else writes.set[key] = parseBridgeJson(value, `store value for ${JSON.stringify(key)}`);
  }
  return writes;
}

export function parseScriptError(json: string): CodemodeError {
  const parsed = parseBridgeJson(json, "script error");
  if (typeof parsed !== "object" || parsed === null)
    throw new BridgeError("script error is not an object");
  const { name, message, stack } = parsed as Record<string, unknown>;
  if (
    typeof message !== "string" ||
    (name !== undefined && typeof name !== "string") ||
    (stack !== undefined && typeof stack !== "string")
  ) {
    throw new BridgeError("script error is malformed");
  }
  return { kind: "script", name, message, stack };
}
