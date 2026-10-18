import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type { ExecutionEnv } from "../env/index.ts";
import { getOrThrow } from "../env/result.ts";

const UNICODE_SPACES = /[  -   　]/gu;
const NARROW_NO_BREAK_SPACE = " ";

const normalizeToolPath = (path: string): string => {
  const normalized = path.replace(UNICODE_SPACES, " ");
  return normalized.startsWith("@") ? normalized.slice(1) : normalized;
};

const readVariants = (resolved: string): Set<string> =>
  new Set([
    resolved,
    resolved.replace(/ (AM|PM)\./giu, `${NARROW_NO_BREAK_SPACE}$1.`),
    resolved.normalize("NFD"),
    resolved.replace(/'/gu, "’"),
    resolved.normalize("NFD").replace(/'/gu, "’"),
  ]);

export const resolveToolPath = Effect.fnUntraced(function* (
  env: ExecutionEnv,
  path: string,
  context: Context,
) {
  return getOrThrow(
    yield* Effect.promise(() => env.absolutePath(normalizeToolPath(path), context)),
  );
});

export const resolveReadToolPath = Effect.fnUntraced(function* (
  env: ExecutionEnv,
  path: string,
  context: Context,
) {
  const resolved = yield* resolveToolPath(env, path, context);
  for (const variant of readVariants(resolved)) {
    if (getOrThrow(yield* Effect.promise(() => env.exists(variant, context)))) return variant;
  }
  return resolved;
});
