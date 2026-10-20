import { dual } from "effect/Function";

import type typesModule from "../types.ts";
import bridgePrelude from "./bridge-prelude.ts";
import RuntimeError from "./runtime-error.ts";

const { PRELUDE_HEAD } = bridgePrelude;

const bridgeError = (message: string) => new RuntimeError({ message, reason: "bridge" });

function toCodemodeIdentifier(name: string): string {
  let identifier = "";
  for (const char of name) {
    const valid = identifier === "" ? /^[A-Za-z_$]$/u.test(char) : /^[A-Za-z0-9_$]$/u.test(char);
    identifier += valid ? char : "_";
  }
  return identifier === "" ? "_" : identifier;
}

const parseBridgeJson: {
  (what: string): (json: string) => unknown;
  (json: string, what: string): unknown;
} = dual(2, (json: string, what: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    throw bridgeError(`${what} is not valid JSON`);
  }
});

const isWriteEntry = (entry: unknown): entry is [string, string?] =>
  Array.isArray(entry) &&
  typeof entry[0] === "string" &&
  (entry.length === 2 ? typeof entry[1] === "string" : entry.length === 1);

function parseStoreWrites(json: string): typesModule.CodemodeStoreWrites {
  const entries = parseBridgeJson(json, "store writes");
  if (!Array.isArray(entries)) throw bridgeError("store writes are not an array");
  const writes: typesModule.CodemodeStoreWrites = { delete: [], set: {} };
  for (const entry of entries) {
    if (!isWriteEntry(entry)) throw bridgeError("store writes contain a malformed entry");
    const [key, value] = entry;
    if (value === undefined) writes.delete.push(key);
    else writes.set[key] = parseBridgeJson(value, `store value for ${JSON.stringify(key)}`);
  }
  return writes;
}

function parseScriptError(json: string): typesModule.CodemodeError {
  const parsed = parseBridgeJson(json, "script error");
  if (typeof parsed !== "object" || parsed === null)
    throw bridgeError("script error is not an object");
  const { name, message, stack } = parsed as Record<string, unknown>;
  if (
    typeof message !== "string" ||
    (name !== undefined && typeof name !== "string") ||
    (stack !== undefined && typeof stack !== "string")
  ) {
    throw bridgeError("script error is malformed");
  }
  return { kind: "script", message, name, stack };
}

const bridge = {
  PRELUDE_HEAD,
  RuntimeError,
  parseBridgeJson,
  parseScriptError,
  parseStoreWrites,
  toCodemodeIdentifier,
};

export default bridge;
