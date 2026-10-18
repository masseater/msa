import type { Context } from "@msa/chord";
import { Deferred, Effect, Function } from "effect";

import type { ExecutionEnv } from "../env/index.ts";
import { getOrThrow } from "../env/result.ts";
import type { ToolExecutionApi } from "../harness/types.ts";

export function requireEnv(api: ToolExecutionApi): ExecutionEnv {
  if (api.env === undefined) throw new Error("No execution environment is configured");
  return api.env;
}

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

const queues = new Map<string, Deferred.Deferred<void>>();

const canonical = (
  env: ExecutionEnv,
  absolutePath: string,
  context: Context,
): Effect.Effect<string> =>
  Effect.flatMap(
    Effect.promise(() => env.canonicalPath(absolutePath, context)),
    (result) => {
      if (result.ok) return Effect.succeed(result.value);
      if (result.error.code === "not_supported") return Effect.succeed(absolutePath);
      if (result.error.code !== "not_found") return Effect.die(result.error);
      return canonicalMissing(env, absolutePath, context);
    },
  );

const canonicalMissing = Effect.fnUntraced(function* (
  env: ExecutionEnv,
  absolutePath: string,
  context: Context,
) {
  const parent = getOrThrow(
    yield* Effect.promise(() => env.joinPath([absolutePath, ".."], context)),
  );
  if (parent === absolutePath || !absolutePath.startsWith(parent)) return absolutePath;
  const name = absolutePath.slice(parent.length + (/[/\\]$/u.test(parent) ? 0 : 1));
  const canonicalParent = yield* canonical(env, parent, context);
  return getOrThrow(yield* Effect.promise(() => env.joinPath([canonicalParent, name], context)));
});

const mutationKey = Effect.fnUntraced(function* (
  env: ExecutionEnv,
  path: string,
  context: Context,
) {
  const absolutePath = getOrThrow(yield* Effect.promise(() => env.absolutePath(path, context)));
  return `${env.id}\0${yield* canonical(env, absolutePath, context)}`;
});

export const fileMutation = Effect.fnUntraced(function* <T>(
  env: ExecutionEnv,
  path: string,
  run: Effect.Effect<T>,
  context: Context,
) {
  const key = yield* mutationKey(env, path, context);
  const previous = queues.get(key);
  const done = Deferred.makeUnsafe<void>();
  queues.set(key, done);
  if (previous !== undefined) yield* Deferred.await(previous);
  return yield* Effect.ensuring(
    run,
    Effect.sync(() => {
      Deferred.doneUnsafe(done, Effect.void);
      if (queues.get(key) === done) queues.delete(key);
    }),
  );
});

export const withFileMutationQueue: {
  <T>(path: string, fn: () => Promise<T>, context: Context): (env: ExecutionEnv) => Promise<T>;
  <T>(env: ExecutionEnv, path: string, fn: () => Promise<T>, context: Context): Promise<T>;
} = Function.dual(
  4,
  <T>(env: ExecutionEnv, path: string, fn: () => Promise<T>, context: Context): Promise<T> =>
    Effect.runPromise(fileMutation(env, path, Effect.promise(fn), context)),
);
