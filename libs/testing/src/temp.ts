import { tmpdir } from "node:os";

import { Effect, FileSystem, Predicate, Schedule } from "effect";

import { joinPath } from "./paths.ts";
import { provideNode } from "./runtime.ts";

const withFileSystem = <A, E>(
  use: (service: FileSystem.FileSystem) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E> =>
  provideNode(Effect.flatMap(FileSystem.FileSystem, (service) => use(service)));

export const tempRoot = (): string => tmpdir();

export const tempPath = (name: string): string => joinPath(tmpdir(), name);

export interface TempFile {
  readonly directory: string;
  readonly path: string;
}

export const makeTempDir = (prefix: string): Effect.Effect<string> =>
  withFileSystem((service) => service.makeTempDirectory({ prefix })).pipe(Effect.orDie);

export const makeTempFile = Effect.fn("makeTempFile")(function* (prefix: string, name: string) {
  const directory = yield* makeTempDir(prefix);
  return { directory, path: joinPath(directory, name) } satisfies TempFile;
});

const retriable = (error: { readonly reason?: unknown }): boolean =>
  Predicate.isTagged(error.reason, "Busy") ||
  Predicate.isTagged(error.reason, "PermissionDenied") ||
  Predicate.isTagged(error.reason, "Unknown");

const remove = (directory: string) =>
  withFileSystem((service) => service.remove(directory, { recursive: true, force: true }));

export const removeDir = (directory: string): Effect.Effect<void> =>
  Effect.orDie(remove(directory));

export const removeDirRetrying = (directory: string): Effect.Effect<void> =>
  Effect.orDie(
    remove(directory).pipe(
      Effect.retry({ times: 80, schedule: Schedule.spaced(100), while: retriable }),
    ),
  );

export const removeDirs = (directories: Iterable<string>): Effect.Effect<void> =>
  Effect.forEach(directories, removeDir, { discard: true });
