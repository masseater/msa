import type { Context } from "@msa/chord";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { Clock, Effect, Schema } from "effect";

import envModule from "../env/index.ts";
import type envTypes from "../env/index.types.ts";
import type envConformanceSupportTypes from "./env-conformance-support.types.ts";

const { getOrThrow } = envModule;

const context = BACKGROUND_CONTEXT;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const watchTimeoutMs = 30_000;

const abortedContext = (): Context => {
  const controller = new AbortController();
  controller.abort();
  return withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
};

const errorCode = (result: envTypes.Result<unknown, { code: string }>): string | undefined =>
  result.ok ? undefined : result.error.code;

const value = <A, E>(operation: () => Promise<envTypes.Result<A, E>>): Effect.Effect<A> =>
  Effect.map(Effect.promise(operation), getOrThrow);

const codeOf = (
  operation: () => Promise<envTypes.Result<unknown, { code: string }>>,
): Effect.Effect<string | undefined> => Effect.map(Effect.promise(operation), errorCode);

const settled = <A>(operation: () => Promise<A>): Effect.Effect<A> => Effect.promise(operation);

const readAll = Effect.fnUntraced(function* (
  env: envTypes.ExecutionEnv,
  path: string,
  maxEntries: number,
) {
  const reader = yield* value(() => env.openDirReader(path, context));
  const pages: envTypes.FileInfo[][] = [];
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      for (let read = 0; read < 1000; read += 1) {
        const next = yield* value(() => reader.next(maxEntries, context));
        pages.push(next.entries);
        if (next.done) return { done: true, pages };
      }
      return { done: false, pages };
    }),
    settled(() => reader.close(context)),
  );
});

const letter = { directory: "d", file: "f", symlink: "l" } as const;

const listed = Effect.fnUntraced(function* (
  env: envTypes.ExecutionEnv,
  path: string,
  options?: envTypes.ListFilesOptions,
) {
  const { listFiles } = env;
  if (listFiles === undefined) throw new Error("The environment does not implement listFiles");
  const listing = yield* value(() => listFiles.call(env, path, options, context));
  return {
    entries: listing.entries.map((entry) => `${letter[entry.kind]} ${entry.path}`),
    truncated: listing.truncated,
  };
});

const execCollect = Effect.fnUntraced(function* (
  env: envTypes.ExecutionEnv,
  command: string | readonly string[],
  cwd?: string,
) {
  const output: Record<envTypes.ShellOutputInfo["stream"], string> = { stderr: "", stdout: "" };
  const result = yield* settled(() =>
    env.exec(
      command,
      {
        ...(cwd === undefined ? {} : { cwd }),
        onOutput: (text, _context, info) => {
          output[info.stream] += text;
        },
      },
      context,
    ),
  );
  return { result, ...output };
});

const covers = (change: envTypes.WatchChange, path: string): boolean => {
  if ("overflow" in change) return true;
  if (!("paths" in change)) return false;
  return change.paths.some(
    (reported) =>
      path === reported || path.startsWith(`${reported}/`) || path.startsWith(`${reported}\\`),
  );
};

const changesJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const awaitChange = Effect.fnUntraced(function* (
  changes: readonly envTypes.WatchChange[],
  from: number,
  target: string,
) {
  const deadline = (yield* Clock.currentTimeMillis) + 3000;
  while (!changes.slice(from).some((entry) => covers(entry, target))) {
    if ((yield* Clock.currentTimeMillis) > deadline) {
      const got = yield* Effect.orDie(changesJson(changes.slice(from)));
      throw new Error(`No change reported ${target}; got ${got}`);
    }
    yield* Effect.sleep(20);
  }
});

const watching = Effect.fnUntraced(function* (
  env: envTypes.ExecutionEnv,
  targets: readonly envTypes.WatchTarget[],
  run: (helpers: envConformanceSupportTypes.Watching) => Effect.Effect<void>,
) {
  const changes: envTypes.WatchChange[] = [];
  const watcher = yield* value(() => env.watch(targets, (change) => changes.push(change), context));
  const absolute = (path: string) => value(() => env.absolutePath(path, context));
  yield* Effect.ensuring(
    run({
      absolute,
      changes,
      expectChange: (path, change) =>
        Effect.gen(function* () {
          const target = yield* absolute(path);
          const from = changes.length;
          yield* change;
          yield* awaitChange(changes, from, target);
        }),
    }),
    settled(() => watcher.close(context)),
  );
});

const envConformanceSupport = {
  abortedContext,
  codeOf,
  context,
  decoder,
  encoder,
  errorCode,
  execCollect,
  listed,
  readAll,
  settled,
  value,
  watchTimeoutMs,
  watching,
};

export default envConformanceSupport;
