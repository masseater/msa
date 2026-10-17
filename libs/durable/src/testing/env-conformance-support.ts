import type { Context } from "@msa/chord";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { Clock, Effect, Schema } from "effect";

import {
  type ExecutionEnv,
  type FileInfo,
  getOrThrow,
  type ListFilesOptions,
  type Result,
  type ShellOutputInfo,
  type WatchChange,
  type WatchTarget,
} from "../env/index.ts";
import type { EnvConformanceAssertions } from "./types.ts";

export const context = BACKGROUND_CONTEXT;
export const decoder = new TextDecoder();
export const encoder = new TextEncoder();

export interface EnvSuite {
  readonly assert: EnvConformanceAssertions;
  readonly shell: readonly string[];
}

export interface EnvCaseSpec {
  readonly name: string;
  readonly timeoutMs?: number;
  readonly test: (env: ExecutionEnv, suite: EnvSuite) => Effect.Effect<void>;
}

export const watchTimeoutMs = 30_000;

export const abortedContext = (): Context => {
  const controller = new AbortController();
  controller.abort();
  return withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
};

export const errorCode = (result: Result<unknown, { code: string }>): string | undefined =>
  result.ok ? undefined : result.error.code;

export const value = <A, E>(operation: () => Promise<Result<A, E>>): Effect.Effect<A> =>
  Effect.map(Effect.promise(operation), getOrThrow);

export const codeOf = (
  operation: () => Promise<Result<unknown, { code: string }>>,
): Effect.Effect<string | undefined> => Effect.map(Effect.promise(operation), errorCode);

export const settled = <A>(operation: () => Promise<A>): Effect.Effect<A> =>
  Effect.promise(operation);

export const readAll = Effect.fnUntraced(function* (
  env: ExecutionEnv,
  path: string,
  maxEntries: number,
) {
  const reader = yield* value(() => env.openDirReader(path, context));
  const pages: FileInfo[][] = [];
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      for (let read = 0; read < 1000; read += 1) {
        const next = yield* value(() => reader.next(maxEntries, context));
        pages.push(next.entries);
        if (next.done) return { pages, done: true };
      }
      return { pages, done: false };
    }),
    settled(() => reader.close(context)),
  );
});

const letter = { file: "f", directory: "d", symlink: "l" } as const;

export const listed = Effect.fnUntraced(function* (
  env: ExecutionEnv,
  path: string,
  options?: ListFilesOptions,
) {
  const { listFiles } = env;
  if (listFiles === undefined) throw new Error("The environment does not implement listFiles");
  const listing = yield* value(() => listFiles.call(env, path, options, context));
  return {
    entries: listing.entries.map((entry) => `${letter[entry.kind]} ${entry.path}`),
    truncated: listing.truncated,
  };
});

export const execCollect = Effect.fnUntraced(function* (
  env: ExecutionEnv,
  command: string | readonly string[],
  cwd?: string,
) {
  const output: Record<ShellOutputInfo["stream"], string> = { stdout: "", stderr: "" };
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

const covers = (change: WatchChange, path: string): boolean => {
  if ("overflow" in change) return true;
  if (!("paths" in change)) return false;
  return change.paths.some(
    (reported) =>
      path === reported || path.startsWith(`${reported}/`) || path.startsWith(`${reported}\\`),
  );
};

export interface Watching {
  readonly changes: WatchChange[];
  expectChange(path: string, change: Effect.Effect<void>): Effect.Effect<void>;
  absolute(path: string): Effect.Effect<string>;
}

const changesJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const awaitChange = Effect.fnUntraced(function* (
  changes: readonly WatchChange[],
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

export const watching = Effect.fnUntraced(function* (
  env: ExecutionEnv,
  targets: readonly WatchTarget[],
  run: (helpers: Watching) => Effect.Effect<void>,
) {
  const changes: WatchChange[] = [];
  const watcher = yield* value(() => env.watch(targets, (change) => changes.push(change), context));
  const absolute = (path: string) => value(() => env.absolutePath(path, context));
  yield* Effect.ensuring(
    run({
      changes,
      absolute,
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
